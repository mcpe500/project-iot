const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const RecognitionRequest = sequelize.define('RecognitionRequest', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    filename: {
      type: DataTypes.STRING,
      allowNull: false
    },
    deviceId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM('pending', 'processing', 'completed', 'error'),
      defaultValue: 'pending'
    },
    result: {
      type: DataTypes.JSON,
      allowNull: true
    },
    requestedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    completedAt: {
      type: DataTypes.DATE,
      allowNull: true
    }
  });

  return RecognitionRequest;
};