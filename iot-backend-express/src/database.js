const { Sequelize } = require('sequelize');
const dotenv = require('dotenv');

dotenv.config();

// Create Sequelize instance
const sequelize = new Sequelize(
  process.env.DB_DATABASE || 'iot_dashboard',
  process.env.DB_USER || 'root',
  process.env.DB_PASSWORD || '',
  {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    dialect: 'mysql',
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000
    },
    define: {
      timestamps: true,
      underscored: false,
      freezeTableName: true
    }
  }
);

// Import models
const Device = require('./models/Device')(sequelize);
const SensorData = require('./models/SensorData')(sequelize);

// // Define associations
// Device.hasMany(SensorData, {
//   foreignKey: 'deviceId',
//   sourceKey: 'id',
//   as: 'sensorData'
// });

// SensorData.belongsTo(Device, {
//   foreignKey: 'deviceId',
//   targetKey: 'id',
//   as: 'device'
// });

// Database initialization function
async function initializeDatabase() {
  try {
    // Test connection
    await sequelize.authenticate();
    console.log('✅ Database connection established successfully.');

    // Try to sync models gracefully
    try {
      // First try without altering
      await sequelize.sync({ 
        alter: false,
        force: false
      });
      console.log('✅ Database models synchronized successfully.');
    } catch (syncError) {
      console.warn('⚠️  Initial sync failed, trying alternative approach...');
      
      // If sync fails, try to sync each model individually
      try {
        await Device.sync({ alter: false, force: false });
        console.log('✅ Device model synchronized.');
        
        await SensorData.sync({ alter: false, force: false });
        console.log('✅ SensorData model synchronized.');
      } catch (individualSyncError) {
        console.warn('⚠️  Individual sync also failed, continuing without sync...');
        console.warn('Database tables may need manual creation.');
      }
    }

    // Add helper methods to sequelize instance
    sequelize.verifyConnection = async function() {
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
  } catch (error) {
    console.error('❌ Unable to connect to the database:', error);
    throw error;
  }
}

// Export models and sequelize instance
module.exports = {
  sequelize,
  Device,
  SensorData,
  initializeDatabase
};