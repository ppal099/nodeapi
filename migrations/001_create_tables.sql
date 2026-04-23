-- Create deliveries table
CREATE TABLE deliveries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  delivery_id VARCHAR(255) NOT NULL UNIQUE,
  status ENUM('picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'failed') NOT NULL,
  client_id INT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create clients table (assuming it exists or add if needed)
-- CREATE TABLE clients (
--   id INT AUTO_INCREMENT PRIMARY KEY,
--   name VARCHAR(255),
--   webhook_url VARCHAR(500)
-- );

-- Create failed_notifications table
CREATE TABLE failed_notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  delivery_id VARCHAR(255) NOT NULL,
  client_id INT NOT NULL,
  attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  failure_reason TEXT
);