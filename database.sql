CREATE DATABASE IF NOT EXISTS dk_gaming_zone
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE dk_gaming_zone;

CREATE TABLE IF NOT EXISTS owners (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(160) NOT NULL UNIQUE,
  password_salt VARCHAR(64) NOT NULL,
  password_hash VARCHAR(160) NOT NULL,
  recovery_question VARCHAR(255) NOT NULL,
  recovery_salt VARCHAR(64) NOT NULL,
  recovery_hash VARCHAR(160) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS categories (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS products (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(180) NOT NULL,
  category VARCHAR(120) NOT NULL DEFAULT 'Gaming Gear',
  old_price DECIMAL(12, 2) NOT NULL DEFAULT 0,
  new_price DECIMAL(12, 2) NOT NULL DEFAULT 0,
  discount INT NOT NULL DEFAULT 0,
  single_image VARCHAR(500) NOT NULL,
  description TEXT NULL,
  tags JSON NULL,
  specs JSON NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS product_images (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  product_id INT UNSIGNED NOT NULL,
  image_url VARCHAR(500) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_product_images_product
    FOREIGN KEY (product_id) REFERENCES products(id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS settings (
  setting_key VARCHAR(120) PRIMARY KEY,
  setting_value JSON NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS orders (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_number VARCHAR(60) NOT NULL UNIQUE,
  customer_name VARCHAR(160) NOT NULL,
  customer_phone VARCHAR(60) NOT NULL,
  customer_address TEXT NOT NULL,
  payment_method ENUM('cod', 'easypaisa', 'jazzcash', 'bankTransfer') NOT NULL DEFAULT 'cod',
  subtotal DECIMAL(12, 2) NOT NULL DEFAULT 0,
  shipping DECIMAL(12, 2) NOT NULL DEFAULT 0,
  tax DECIMAL(12, 2) NOT NULL DEFAULT 0,
  total DECIMAL(12, 2) NOT NULL DEFAULT 0,
  status ENUM('pending', 'confirmed', 'processing', 'delivered', 'cancelled') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS order_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id INT UNSIGNED NOT NULL,
  product_id INT UNSIGNED NULL,
  product_name VARCHAR(180) NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  unit_price DECIMAL(12, 2) NOT NULL DEFAULT 0,
  line_total DECIMAL(12, 2) NOT NULL DEFAULT 0,
  CONSTRAINT fk_order_items_order
    FOREIGN KEY (order_id) REFERENCES orders(id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

INSERT INTO settings (setting_key, setting_value)
VALUES
  ('store', JSON_OBJECT(
    'currency', 'PKR',
    'taxRate', 0,
    'freeShippingMin', 50000,
    'localShippingFee', 250,
    'storePhone', '+92 345 5222815',
    'storeLocation', 'Street Number 46/5, Allama Iqbal Colony, Rawalpindi, 46000, Pakistan',
    'paymentMethods', JSON_OBJECT('cod', true, 'easypaisa', true, 'jazzcash', true, 'bankTransfer', true)
  ))
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);
