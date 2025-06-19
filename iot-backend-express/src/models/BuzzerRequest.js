const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const BuzzerRequest = sequelize.define('buzzer_requests', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      comment: 'Auto-incrementing primary key'
    },
    deviceId: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: 'Reference to the device that made the request'
    },
    requestedAt: {
      type: DataTypes.BIGINT,
      allowNull: false,
      comment: 'Timestamp when the request was made'
    },
    buzzedAt: {
      type: DataTypes.BIGINT,
      allowNull: true,
      comment: 'Timestamp when the request was completed'
    },
    status: {
      type: DataTypes.ENUM('pending', 'completed'),
      defaultValue: 'pending',
      allowNull: false,
      comment: 'Current status of the request'
    }
  }, {
    timestamps: true,
    paranoid: true, // Enables soft deletion
    indexes: [
      {
        fields: ['deviceId']
      },
      {
        fields: ['status']
      },
      {
        fields: ['requestedAt']
      }
    ],
    comment: 'Buzzer control requests from IoT devices'
  });

  return BuzzerRequest;
};