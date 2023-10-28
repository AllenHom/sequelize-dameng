"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
const AbstractConnectionManager = require("../abstract/connection-manager");
const SequelizeErrors = require("../../errors");
const { logger } = require("../../utils/logger");
const DataTypes = require("../../data-types").dm;
const momentTz = require("moment-timezone");
const debug = logger.debugContext("connection:dmdb");
const parserStore = require("../parserStore")("dm");
const { promisify } = require("util");
class ConnectionManager extends AbstractConnectionManager {
  constructor(dialect, sequelize) {
    sequelize.config.port = sequelize.config.port || 5236;
    super(dialect, sequelize);
    this.lib = this._loadDialectModule("dmdb");
    this.lib.fetchAsString = [this.lib.CLOB];
    this.refreshTypeParser(DataTypes);
  }
  _refreshTypeParser(dataType) {
    parserStore.refresh(dataType);
  }
  _clearTypeParser() {
    parserStore.clear();
  }
  static _typecast(field, next) {
    if (parserStore.get(field.type)) {
      return parserStore.get(field.type)(field, this.sequelize.options, next);
    }
    return next();
  }
  async connect(config) {
    const connectionConfig = __spreadValues({
      connectString: `dm://${config.username}:${config.password}@${config.host}:${config.port}?autoCommit=false&loginEncrypt=false`,
      user: config.username,
      password: config.password,
      modelName: config.database,
      schema: config.database,
      timezone: this.sequelize.options.timezone,
      typeCast: ConnectionManager._typecast.bind(this),
      bigNumberStrings: false,
      supportBigNumbers: true
    }, config.dialectOptions);
    
    try {
      const connection = await new Promise((resolve, reject) => {
        this.lib.createPool(connectionConfig, async (err, pool) => {
          if(err) {
            return;
          }
          const conn = await pool.getConnection();
          const errorHandler = (e) => {
            conn.removeListener("connect", connectHandler);
            conn.removeListener("error", connectHandler);
            reject(e);
          };
          const connectHandler = () => {
            conn.removeListener("error", errorHandler);
            resolve(conn);
          };
          conn.on("error", errorHandler);
          conn.once("connect", connectHandler);
          if (err)
            return errorHandler(err);
          connectHandler();
        });
      });

      connection.on("error", (error) => {
        switch (error.code) {
          case "ESOCKET":
          case "ECONNRESET":
          case "EPIPE":
          case "PROTOCOL_CONNECTION_LOST": {
            console.log('===error=', error);
            this.pool.destroy(connection);
          }
        }
      });
      return connection;
    } catch (err) {
      switch (err.code) {
        case "ECONNREFUSED":
          throw new SequelizeErrors.ConnectionRefusedError(err);
        case "ER_ACCESS_DENIED_ERROR":
          throw new SequelizeErrors.AccessDeniedError(err);
        case "ENOTFOUND":
          throw new SequelizeErrors.HostNotFoundError(err);
        case "EHOSTUNREACH":
          throw new SequelizeErrors.HostNotReachableError(err);
        case "EINVAL":
          throw new SequelizeErrors.InvalidConnectionError(err);
        default:
          throw new SequelizeErrors.ConnectionError(err);
      }
    }
  }
  async disconnect(connection) {
    if (connection._closing) {
      debug("connection tried to disconnect but was already at CLOSED state");
      return;
    }
    return await promisify((callback) => connection.close(callback))();
  }
  validate(connection) {
    return connection && !connection._fatalError && !connection._protocolError && !connection.closed;
  }
}
module.exports = ConnectionManager;
module.exports.ConnectionManager = ConnectionManager;
module.exports.default = ConnectionManager;
//# sourceMappingURL=connection-manager.js.map
