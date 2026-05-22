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

function ordersTableName() {
  return tableName("DB_ORDERS_TABLE", "evspeare_orders");
}

function orderItemsTableName() {
  return tableName("DB_ORDER_ITEMS_TABLE", "evspeare_order_items");
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

async function tableColumns(table) {
  const rows = clientName().startsWith("postgres")
    ? await query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1",
        [table]
      )
    : await query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = $1",
        [table]
      );

  return new Set(rows.map((row) => String(row.column_name || row.COLUMN_NAME || "").toLowerCase()));
}

async function tableExists(table) {
  const rows = clientName().startsWith("postgres")
    ? await query(
        "SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1 LIMIT 1",
        [table]
      )
    : await query(
        "SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = $1 LIMIT 1",
        [table]
      );
  return rows.length > 0;
}

function firstExisting(columns, names) {
  return names.find((name) => columns.has(name.toLowerCase())) || "";
}

function selectAlias(columns, alias, names) {
  const column = firstExisting(columns, names);
  return column ? `${quoteId(column)} AS ${quoteId(alias)}` : `NULL AS ${quoteId(alias)}`;
}

function publicImageUrl(value) {
  const image = String(value || "");
  if (image.startsWith("gs://")) {
    return `/api/mobile/images?src=${encodeURIComponent(image)}`;
  }

  try {
    const url = new URL(image);
    if (
      url.hostname === "storage.googleapis.com" ||
      url.hostname === "firebasestorage.googleapis.com" ||
      url.hostname.endsWith(".storage.googleapis.com")
    ) {
      return `/api/mobile/images?src=${encodeURIComponent(image)}`;
    }
  } catch (error) {
    // Non-URL values are handled below.
  }

  if (image.startsWith("/") && process.env.IMAGE_BASE_URL) {
    return `${process.env.IMAGE_BASE_URL.replace(/\/+$/g, "")}${image}`;
  }

  return image;
}

async function productSelectSql() {
  if (process.env.DB_PRODUCTS_QUERY) return process.env.DB_PRODUCTS_QUERY;

  const rawTable = tableName("DB_PRODUCTS_TABLE", "products");
  const columns = await tableColumns(rawTable);
  const table = quoteId(rawTable);
  const activeColumn = process.env.DB_PRODUCTS_ACTIVE_COLUMN || "";
  const activeClause = activeColumn && /^[a-zA-Z0-9_]+$/.test(activeColumn) && columns.has(activeColumn.toLowerCase())
    ? ` WHERE ${quoteId(activeColumn)} IN (1, true, '1', 'true', 'active', 'publish')`
    : "";
  const orderColumn = firstExisting(columns, ["id", "product_id", "created_at", "updated_at"]);
  const orderClause = orderColumn ? `ORDER BY ${quoteId(orderColumn)} DESC` : "";
  const limit = Number(process.env.DB_PRODUCTS_LIMIT || 100);

  return `
    SELECT
      ${selectAlias(columns, "id", ["id", "product_id"])},
      ${selectAlias(columns, "product_id", ["product_id", "id"])},
      ${selectAlias(columns, "name", ["name", "product_name", "title"])},
      ${selectAlias(columns, "title", ["title", "name", "product_name"])},
      ${selectAlias(columns, "sku", ["sku", "product_sku"])},
      ${selectAlias(columns, "price", ["price", "sale_price", "selling_price", "final_price"])},
      ${selectAlias(columns, "sale_price", ["sale_price", "selling_price", "price"])},
      ${selectAlias(columns, "selling_price", ["selling_price", "sale_price", "price"])},
      ${selectAlias(columns, "mrp", ["mrp", "regular_price", "original_price", "compare_at_price", "price"])},
      ${selectAlias(columns, "regular_price", ["regular_price", "mrp", "original_price", "compare_at_price", "price"])},
      ${selectAlias(columns, "original_price", ["original_price", "regular_price", "mrp", "compare_at_price", "price"])},
      ${selectAlias(columns, "image", ["image", "image_url", "thumbnail", "photo"])},
      ${selectAlias(columns, "image_url", ["image_url", "image", "thumbnail", "photo"])},
      ${selectAlias(columns, "category", ["category", "category_name", "product_category"])},
      ${selectAlias(columns, "rating", ["rating", "average_rating"])},
      ${selectAlias(columns, "average_rating", ["average_rating", "rating"])},
      ${selectAlias(columns, "reviews", ["reviews", "rating_count", "review_count"])},
      ${selectAlias(columns, "rating_count", ["rating_count", "review_count", "reviews"])},
      ${selectAlias(columns, "stock_status", ["stock_status", "status", "availability"])},
      ${selectAlias(columns, "in_stock", ["in_stock", "is_in_stock"])},
      ${selectAlias(columns, "stock_quantity", ["stock_quantity", "inventory", "inventory_qty", "inventory_quantity", "available_quantity", "available_stock", "qty", "quantity", "stock"])}
    FROM ${table}
    ${activeClause}
    ${orderClause}
    LIMIT ${limit}
  `;
}

function numericOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value ? null : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function productStockStatus(row) {
  const quantity = numericOrNull(row.stock_quantity);
  const status = String(row.stock_status || "").toLowerCase();
  const inStock = row.in_stock;

  if (quantity !== null && quantity <= 0) return "out_of_stock";
  if (["out_of_stock", "out of stock", "sold_out", "sold out", "unavailable"].includes(status)) return "out_of_stock";
  if (inStock === false || inStock === 0 || inStock === "0" || String(inStock).toLowerCase() === "false") return "out_of_stock";
  return row.stock_status || "available";
}

async function inventoryTableInfo() {
  const candidates = process.env.DB_INVENTORY_TABLE
    ? [process.env.DB_INVENTORY_TABLE]
    : ["warehouse_inventory", "product_inventory", "inventory", "inventories", "stocks", "stock"];

  for (const table of candidates) {
    if (!/^[a-zA-Z0-9_]+$/.test(table)) continue;
    if (!(await tableExists(table))) continue;

    const columns = await tableColumns(table);
    const productColumn = firstExisting(columns, [
      "product_id",
      "productid",
      "product",
      "item_id",
      "itemid",
      "sku",
      "product_sku"
    ]);
    const quantityColumn = firstExisting(columns, [
      "stock_quantity",
      "inventory",
      "inventory_qty",
      "inventory_quantity",
      "available_quantity",
      "available_stock",
      "warehouse_stock",
      "warehouse_inventory",
      "current_stock",
      "stock_count",
      "qty",
      "quantity",
      "stock",
      "on_hand"
    ]);

    if (productColumn && quantityColumn) {
      return { table, productColumn, quantityColumn };
    }
  }

  return null;
}

async function applyInventory(products) {
  if (!products.length) return products;

  const info = await inventoryTableInfo();
  if (!info) return products;

  const ids = [...new Set(products.flatMap((product) => [product.sourceId, product.id]).filter((value) => value !== null && value !== undefined))];
  if (!ids.length) return products;

  const placeholders = ids.map((_, index) => placeholder(index + 1)).join(",");
  const rows = await query(
    `SELECT ${quoteId(info.productColumn)} AS product_id, ${quoteId(info.quantityColumn)} AS stock_quantity
     FROM ${quoteId(info.table)}
     WHERE ${quoteId(info.productColumn)} IN (${placeholders})`,
    ids
  );
  const inventory = new Map(rows.map((row) => [String(row.product_id), numericOrNull(row.stock_quantity)]));

  return products.map((product) => {
    const quantity = inventory.get(String(product.sourceId)) ?? inventory.get(String(product.id)) ?? product.stockQuantity;
    if (quantity === null || quantity === undefined) return product;
    return {
      ...product,
      stockQuantity: quantity,
      stock: quantity <= 0 ? "out_of_stock" : "available"
    };
  });
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
    image: publicImageUrl(row.image || row.image_url) || "https://images.unsplash.com/photo-1607082350899-7e105aa886ae?auto=format&fit=crop&w=420&q=80",
    stock: productStockStatus(row),
    stockQuantity: numericOrNull(row.stock_quantity)
  };
}

async function fetchProducts() {
  if (!enabled()) return null;
  const rows = await query(await productSelectSql());
  const products = rows.map(asProduct).filter((product) => product.price > 0);
  return applyInventory(products);
}

async function ensureOrderTables() {
  if (process.env.DB_AUTO_CREATE_TABLES === "false") return;

  const orders = quoteId(ordersTableName());
  const items = quoteId(orderItemsTableName());

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

  const orders = quoteId(ordersTableName());
  const items = quoteId(orderItemsTableName());
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

function parsePayload(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    return {};
  }
}

async function fetchCustomerOrders(phone) {
  if (!enabled()) return null;

  const orders = quoteId(ordersTableName());
  try {
    const rows = await query(
      `SELECT
        order_id,
        customer_name,
        customer_phone,
        amount_total,
        payment_method,
        payment_status,
        status,
        payload,
        created_at
       FROM ${orders}
       WHERE customer_phone = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [phone]
    );

    return rows.map((row) => {
      const payload = parsePayload(row.payload);
      return {
        orderId: row.order_id,
        customerName: row.customer_name,
        customerPhone: row.customer_phone,
        amountTotal: Number(row.amount_total || payload.amounts?.total || 0),
        paymentMethod: row.payment_method || payload.payment?.method || "",
        paymentStatus: row.payment_status || payload.payment?.status || "",
        status: row.status || payload.status || "placed",
        createdAt: row.created_at,
        items: payload.items || [],
        tracking: payload.tracking || null
      };
    });
  } catch (error) {
    if (String(error.message || "").includes("does not exist")) return [];
    throw error;
  }
}

function status() {
  return {
    configured: enabled(),
    client: clientName() || null,
    urlSet: Boolean(databaseUrl()),
    productsTable: process.env.DB_PRODUCTS_TABLE || "products",
    inventoryTable: process.env.DB_INVENTORY_TABLE || "auto",
    ordersTable: process.env.DB_ORDERS_TABLE || "evspeare_orders",
    orderItemsTable: process.env.DB_ORDER_ITEMS_TABLE || "evspeare_order_items",
    autoCreateTables: process.env.DB_AUTO_CREATE_TABLES !== "false"
  };
}

module.exports = {
  status,
  fetchProducts,
  insertOrder,
  fetchCustomerOrders
};
