const { Sequelize } = require('sequelize');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

const dbName = process.env.DB_DATABASE || 'iot_dashboard';
const dbUser = process.env.DB_USER || 'root';
const dbPassword = process.env.DB_PASSWORD || '';
const dbHost = process.env.DB_HOST || 'localhost';
const dbPort = process.env.DB_PORT || 3306;

// Create Sequelize instance (will be re-created if DB is missing)
let sequelize = new Sequelize(dbName, dbUser, dbPassword, {
  host: dbHost,
  port: dbPort,
  dialect: 'mysql',
  logging: process.env.NODE_ENV === 'development' ? console.log : false,
  pool: { max: 5, min: 0, acquire: 30000, idle: 10000 },
  define: { timestamps: true, underscored: false, freezeTableName: true }
});

// Import models (functions, not instances)
const DeviceModel = require('./models/Device');
const SensorDataModel = require('./models/SensorData');
const BuzzerRequestModel = require('./models/BuzzerRequest');

async function createDatabaseIfNotExists() {
  const connection = await mysql.createConnection({
    host: dbHost,
    port: dbPort,
    user: dbUser,
    password: dbPassword
  });
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
  await connection.end();
  console.log(`✅ Database '${dbName}' ensured to exist.`);
}

async function initializeDatabase() {
  try {
    // Try to connect
    await sequelize.authenticate();
    console.log('✅ Database connection established successfully.');
  } catch (error) {
    // If database does not exist, create it and retry
    if (error.original && error.original.code === 'ER_BAD_DB_ERROR') {
      console.warn(`⚠️  Database '${dbName}' does not exist. Creating...`);
      await createDatabaseIfNotExists();
      // Recreate sequelize instance and retry
      sequelize = new Sequelize(dbName, dbUser, dbPassword, {
        host: dbHost,
        port: dbPort,
        dialect: 'mysql',
        logging: process.env.NODE_ENV === 'development' ? console.log : false,
        pool: { max: 5, min: 0, acquire: 30000, idle: 10000 },
        define: { timestamps: true, underscored: false, freezeTableName: true }
      });
      await sequelize.authenticate();
      console.log('✅ Database connection established successfully (after creation).');
    } else {
      console.error('❌ Unable to connect to the database:', error);
      throw error;
    }
  }

  // Initialize models with the (possibly new) sequelize instance
  const Device = DeviceModel(sequelize);
  const SensorData = SensorDataModel(sequelize);
  const BuzzerRequest = BuzzerRequestModel(sequelize);


  // Try to sync models gracefully
  try {
    await sequelize.sync({ alter: false, force: false });
    console.log('✅ Database models synchronized successfully.');
  } catch (syncError) {
    console.warn('⚠️  Initial sync failed, trying alternative approach...');
    try {
      await Device.sync({ alter: false, force: false });
      console.log('✅ Device model synchronized.');
      await SensorData.sync({ alter: false, force: false });
      console.log('✅ SensorData model synchronized.');
      await BuzzerRequest.sync({ alter: false, force: false });
      console.log('✅ BuzzerRequest model synchronized.');
    } catch (individualSyncError) {
      console.warn('⚠️  Individual sync also failed, continuing without sync...');
      console.warn('Database tables may need manual creation.');
    }
  }

  // Add helper methods to sequelize instance
  sequelize.verifyConnection = async function () {
    try {
      await this.authenticate();
      const [results] = await this.query('SELECT VERSION() AS version');
      const version = results[0].version;
      return {
        success: true,
        message: 'Database connection successful',
        version: version
      };
    } catch (error) {
      return {
        success: false,
        message: 'Database connection failed',
        error: error.message,
        version: null
      };
    }
  };

  return sequelize;
}

// Export models and sequelize instance
module.exports = {
  sequelize,
  Device: DeviceModel(sequelize),
  SensorData: SensorDataModel(sequelize),
  BuzzerRequest: BuzzerRequestModel(sequelize),
  initializeDatabase
};