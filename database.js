const mysql = require("mysql2/promise");
const { Pool: PgPool } = require("pg");

let pool;

function databaseUrl() {
  return process.env.DATABASE_URL || process.env.MYSQL_URL || process.env.POSTGRES_URL || "";
}

function clientName() {
  const explicit = (process.env.DATABASE_CLIENT || "").toLowerCase();
  const url = databaseUrl().toLowerCase();

  if (explicit) return explicit;
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) return "postgres";
  if (url.startsWith("mysql://") || url.startsWith("mariadb://")) return "mysql";
  return "";
}

function enabled() {
  return Boolean(databaseUrl() && ["postgres", "postgresql", "mysql", "mariadb"].includes(clientName()));
}

function tableName(envName, fallback) {
  const value = process.env[envName] || fallback;
  if (!/^[a-zA-Z0-9_]+$/.test(value)) {
    throw new Error(`${envName} has invalid table name`);
  }
  return value;
}

function placeholder(index) {
  return clientName().startsWith("postgres") ? `$${index}` : "?";
}

function quoteId(identifier) {
  return clientName().startsWith("postgres") ? `"${identifier}"` : `\`${identifier}\``;
}

function normalizeSql(sql) {
  if (clientName().startsWith("postgres")) return sql;
  return sql.replace(/\$(\d+)/g, "?").replace(/"/g, "`");
}

function createPool() {
  if (pool) return pool;

  if (!enabled()) {
    throw new Error("DATABASE_URL and DATABASE_CLIENT are not configured");
  }

  if (clientName().startsWith("postgres")) {
    pool = new PgPool({
      connectionString: databaseUrl(),
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false }
    });
    return pool;
  }

  pool = mysql.createPool({
    uri: databaseUrl(),
    waitForConnections: true,
    connectionLimit: Number(process.env.DATABASE_CONNECTION_LIMIT || 5),
    ssl: process.env.DATABASE_SSL === "true" ? {} : undefined
  });
  return pool;
}

async function query(sql, params = []) {
  const db = createPool();
  const normalizedSql = normalizeSql(sql);

  if (clientName().startsWith("postgres")) {
    const result = await db.query(normalizedSql, params);
    return result.rows;
  }

  const [rows] = await db.execute(normalizedSql, params);
  return rows;
}

async function execute(sql, params = []) {
  const db = createPool();
  const normalizedSql = normalizeSql(sql);

  if (clientName().startsWith("postgres")) {
    const result = await db.query(normalizedSql, params);
    return result;
  }

  const [result] = await db.execute(normalizedSql, params);
  return result;
}

function productSelectSql() {
  if (process.env.DB_PRODUCTS_QUERY) return process.env.DB_PRODUCTS_QUERY;

  const table = quoteId(tableName("DB_PRODUCTS_TABLE", "products"));
  const activeColumn = process.env.DB_PRODUCTS_ACTIVE_COLUMN || "";
  const activeClause = activeColumn && /^[a-zA-Z0-9_]+$/.test(activeColumn)
    ? ` WHERE ${quoteId(activeColumn)} IN (1, true, '1', 'true', 'active', 'publish')`
    : "";

  return `
    SELECT
      id,
      name,
      title,
      sku,
      price,
      sale_price,
      selling_price,
      mrp,
      regular_price,
      original_price,
      image,
      image_url,
      category,
      rating,
      average_rating,
      reviews,
      rating_count,
      stock_status,
      in_stock
    FROM ${table}
    ${activeClause}
    ORDER BY id DESC
    LIMIT ${Number(process.env.DB_PRODUCTS_LIMIT || 100)}
  `;
}

function asProduct(row, index) {
  const price = Number(row.price || row.sale_price || row.selling_price || 0);
  const mrp = Number(row.mrp || row.regular_price || row.original_price || price);
  const category = row.category || "Deals";

  return {
    id: String(row.id || row.product_id || row.sku || `db-${index}`),
    sourceId: row.id || row.product_id || row.sku || null,
    title: row.title || row.name || "Product",
    category,
    price: price || mrp || 0,
    mrp: mrp || price || 0,
    rating: Number(row.rating || row.average_rating || 4.1),
    reviews: Number(row.reviews || row.rating_count || 0),
    delivery: row.delivery || row.shipping_text || "Delivery available",
    tags: ["Deals", category],
    image: row.image || row.image_url || "https://images.unsplash.com/photo-1607082350899-7e105aa886ae?auto=format&fit=crop&w=420&q=80",
    stock: row.stock_status || row.in_stock || "available"
  };
}

async function fetchProducts() {
  if (!enabled()) return null;
  const rows = await query(productSelectSql());
  return rows.map(asProduct).filter((product) => product.price > 0);
}

async function ensureOrderTables() {
  if (process.env.DB_AUTO_CREATE_TABLES === "false") return;

  const orders = quoteId(tableName("DB_ORDERS_TABLE", "orders"));
  const items = quoteId(tableName("DB_ORDER_ITEMS_TABLE", "order_items"));

  if (clientName().startsWith("postgres")) {
    await execute(`
      CREATE TABLE IF NOT EXISTS ${orders} (
        id SERIAL PRIMARY KEY,
        order_id VARCHAR(80) UNIQUE NOT NULL,
        customer_name VARCHAR(160),
        customer_phone VARCHAR(30),
        customer_address TEXT,
        amount_total NUMERIC(12,2),
        payment_method VARCHAR(40),
        payment_status VARCHAR(40),
        status VARCHAR(60),
        payload JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await execute(`
      CREATE TABLE IF NOT EXISTS ${items} (
        id SERIAL PRIMARY KEY,
        order_id VARCHAR(80) NOT NULL,
        product_id VARCHAR(120),
        title TEXT,
        price NUMERIC(12,2),
        quantity INTEGER,
        line_total NUMERIC(12,2),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    return;
  }

  await execute(`
    CREATE TABLE IF NOT EXISTS ${orders} (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_id VARCHAR(80) UNIQUE NOT NULL,
      customer_name VARCHAR(160),
      customer_phone VARCHAR(30),
      customer_address TEXT,
      amount_total DECIMAL(12,2),
      payment_method VARCHAR(40),
      payment_status VARCHAR(40),
      status VARCHAR(60),
      payload JSON,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await execute(`
    CREATE TABLE IF NOT EXISTS ${items} (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_id VARCHAR(80) NOT NULL,
      product_id VARCHAR(120),
      title TEXT,
      price DECIMAL(12,2),
      quantity INT,
      line_total DECIMAL(12,2),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function insertOrder(order) {
  if (!enabled()) return null;

  await ensureOrderTables();

  const orders = quoteId(tableName("DB_ORDERS_TABLE", "orders"));
  const items = quoteId(tableName("DB_ORDER_ITEMS_TABLE", "order_items"));
  const payload = JSON.stringify(order);
  const values = [
    order.orderId,
    order.customer?.name || "",
    order.customer?.phone || "",
    order.customer?.address || "",
    Number(order.amounts?.total || 0),
    order.payment?.method || "",
    order.payment?.status || "",
    order.status || "",
    payload
  ];

  await execute(
    `INSERT INTO ${orders}
      (order_id, customer_name, customer_phone, customer_address, amount_total, payment_method, payment_status, status, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    values
  );

  for (const item of order.items || []) {
    await execute(
      `INSERT INTO ${items}
        (order_id, product_id, title, price, quantity, line_total)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        order.orderId,
        item.productId || item.appProductId || "",
        item.title || "",
        Number(item.price || 0),
        Number(item.quantity || 0),
        Number(item.total || 0)
      ]
    );
  }

  return {
    storedInDatabase: true,
    orderId: order.orderId
  };
}

function status() {
  return {
    configured: enabled(),
    client: clientName() || null,
    urlSet: Boolean(databaseUrl()),
    productsTable: process.env.DB_PRODUCTS_TABLE || "products",
    ordersTable: process.env.DB_ORDERS_TABLE || "orders",
    orderItemsTable: process.env.DB_ORDER_ITEMS_TABLE || "order_items",
    autoCreateTables: process.env.DB_AUTO_CREATE_TABLES !== "false"
  };
}

module.exports = {
  status,
  fetchProducts,
  insertOrder
};
