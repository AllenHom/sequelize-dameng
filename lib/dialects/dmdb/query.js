'use strict';
const __defProp = Object.defineProperty;
const __getOwnPropSymbols = Object.getOwnPropertySymbols;
const __hasOwnProp = Object.prototype.hasOwnProperty;
const __propIsEnum = Object.prototype.propertyIsEnumerable;
const __defNormalProp = (obj, key, value) => (key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value);
const __spreadValues = (a, b) => {
  for (var prop in b || (b = {})) {
    if (__hasOwnProp.call(b, prop)) { __defNormalProp(a, prop, b[prop]); }
  }
  if (__getOwnPropSymbols) {
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop)) { __defNormalProp(a, prop, b[prop]); }
    }
  }
  return a;
};
const AbstractQuery = require('../abstract/query');
const sequelizeErrors = require('../../errors');
const _ = require('lodash');
const { logger } = require('../../utils/logger');
const ER_DUP_ENTRY = 1062;
const ER_DEADLOCK = 1213;
const ER_ROW_IS_REFERENCED = 1451;
const ER_NO_REFERENCED_ROW = 1452;
const debug = logger.debugContext('sql:dm');
class Query extends AbstractQuery {
  constructor(connection, sequelize, options) {
    super(connection, sequelize, __spreadValues({ showWarnings: false }, options));
    this.maxRows = options.maxRows || 0;
    this.outFormat = options.outFormat || this.sequelize.connectionManager.lib.OUT_FORMAT_OBJECT;
    this.resultSet = options.resultSet === true;
    this.extendedMetaData = options.extendedMetaData === true;
  }
  static formatBindParameters(sql, values, dialect) {
    const bindParam = [];
    const replacementFunc = (match, key, values_) => {
      if (values_[key] !== void 0) {
        bindParam.push(values_[key]);
        return '?';
      }
      return void 0;
    };
    sql = AbstractQuery.formatBindParameters(sql, values, dialect, replacementFunc)[0];
    return [ sql, bindParam.length > 0 ? bindParam : void 0 ];
  }
  async run(sql, parameters) {
    this.sql = sql;
    const { connection, options } = this;
    const showWarnings = this.sequelize.options.showWarnings || options.showWarnings;
    const complete = this._logQuery(sql, debug, parameters);
    if (parameters) {
      debug('parameters(%j)', parameters);
    }
    let results;
    const errForStack = new Error();
    try {
      const execOptions = {
        extendedMetaData: this.extendedMetaData,
        outFormat: this.outFormat,
        resultSet: this.resultSet,
      };
      // console.log('dmdb run sql ', sql);
      if (parameters && parameters.length) {
        results = await new Promise((resolve, reject) => {
          // { ...execOptions, resultSet: true }
          connection.execute(sql, parameters, execOptions, (error, result) => (error ? reject(error) : resolve(result)));
        });
        // console.log('dmdb datas', results.resultSet.datas);
        // console.log('dmdb run sql with parameters results', results);
      } else {
        results = await new Promise((resolve, reject) => {
          connection.execute(sql, {}, execOptions, (error, result) => (error ? reject(error) : resolve(result)));
        });
        // console.log('dmdb run sql results', results);
      }
    } catch (error) {
      if (options.transaction && error.errno === ER_DEADLOCK) {
        try {
          await options.transaction.rollback();
        } catch (error_) {
        }
        options.transaction.finished = 'rollback';
      }
      error.sql = sql;
      error.parameters = parameters;
      throw this.formatError(error, errForStack.stack);
    } finally {
      complete();
    }
    if (showWarnings && results && results.warningStatus > 0) {
      await this.logWarnings(results);
    }
    return this.formatResults(results);
  }
  formatResults(data) {
    let result = this.instance;
    if (this.isInsertQuery(data)) {
      this.handleInsertQuery(data);
      // console.log('formatResults isInsertQuery ', data);
      if (!this.instance) {
        if (data.constructor.name === 'ResultSetHeader' && this.model && this.model.autoIncrementAttribute && this.model.autoIncrementAttribute === this.model.primaryKeyAttribute && this.model.rawAttributes[this.model.primaryKeyAttribute]) {
          const startId = data[this.getInsertIdField()];
          // console.log('formatResults isInsertQuery startId', startId);
          result = [];
          for (let i = startId; i < startId + data.rowsAffected; i++) {
            result.push({ [this.model.rawAttributes[this.model.primaryKeyAttribute].field]: i });
          }
          // console.log('formatResults isInsertQuery result', result);
        } else {
          result = data[this.getInsertIdField()];
          // console.log('formatResults isInsertQuery result', result);
        }
      } else if (this.sequelize.options.dialect === 'dm' && data.rows.length === 1 && result.dataValues.id === undefined) {
        result.dataValues.id = data.rows[0].id;
        // console.log('formatResults isInsertQuery result', result);
      }
    }
    if (this.isSelectQuery()) {
      const props = this.connection.props;
      if (props && props.innerProps && props.innerProps.get('supportbignumbers') && !props.innerProps.get('bignumberstrings') && data.rows) {
        if (this.outFormat === this.sequelize.connectionManager.lib.OUT_FORMAT_OBJECT) {
          data.rows.forEach(item => {
            for (const key in item) {
              if (Object.prototype.hasOwnProperty.call(item, key) && typeof item[key] === 'bigint') {
                item[key] = parseInt(item[key], 10);
              }
            }
          });
        } else {
          data.rows = data.rows.map(item => {
            return item.map(value => {
              if (typeof value === 'bigint') { return parseInt(value, 10); }
              return value;
            });
          });
        }
      }
      return this.handleSelectQuery(data.rows);
    }
    if (this.isShowTablesQuery()) {
      return this.handleShowTablesQuery(data);
    }
    if (this.isDescribeQuery()) {
      result = {};
      for (const _result of data) {
        const enumRegex = /^enum/i;
        result[_result.Field] = {
          type: enumRegex.test(_result.Type) ? _result.Type.replace(enumRegex, 'ENUM') : _result.Type.toUpperCase(),
          allowNull: _result.Null === 'YES',
          defaultValue: _result.Default,
          primaryKey: _result.Key === 'PRI',
          autoIncrement: Object.prototype.hasOwnProperty.call(_result, 'Extra') && _result.Extra.toLowerCase() === 'auto_increment',
          comment: _result.Comment ? _result.Comment : null,
        };
      }
      return result;
    }
    if (this.isShowIndexesQuery()) {
      return this.handleShowIndexesQuery(data);
    }
    if (this.isCallQuery()) {
      return data[0];
    }
    if (this.isBulkUpdateQuery() || this.isBulkDeleteQuery()) {
      return data.rowsAffected;
    }
    if (this.isVersionQuery()) {
      const version = data.rows[0].BANNER;
      return version ? version.substr(version.indexOf('V')) : null;
    }
    if (this.isForeignKeysQuery()) {
      return data;
    }
    if (this.isUpsertQuery()) {
      return [ result, data.rowsAffected === 1 ];
    }
    if (this.isInsertQuery() || this.isUpdateQuery()) {
      return [ result, data.rowsAffected ];
    }
    if (this.isShowConstraintsQuery()) {
      return data;
    }
    if (this.isRawQuery()) {
      return [ data, data ];
    }
    return result;
  }
  async logWarnings(results) {
    const warningResults = await this.run('SHOW WARNINGS');
    const warningMessage = `MySQL Warnings (${this.connection.uuid || 'default'}): `;
    const messages = [];
    for (const _warningRow of warningResults) {
      if (_warningRow === void 0 || typeof _warningRow[Symbol.iterator] !== 'function') {
        continue;
      }
      for (const _warningResult of _warningRow) {
        if (Object.prototype.hasOwnProperty.call(_warningResult, 'Message')) {
          messages.push(_warningResult.Message);
        } else {
          for (const _objectKey of _warningResult.keys()) {
            messages.push([ _objectKey, _warningResult[_objectKey] ].join(': '));
          }
        }
      }
    }
    this.sequelize.log(warningMessage + messages.join('; '), this.options);
    return results;
  }
  formatError(err, errStack) {
    const errCode = err.errno || err.code;
    switch (errCode) {
      case ER_DUP_ENTRY: {
        const match = err.message.match(/Duplicate entry '([\s\S]*)' for key '?((.|\s)*?)'?$/);
        let fields = {};
        let message = 'Validation error';
        const values = match ? match[1].split('-') : void 0;
        const fieldKey = match ? match[2].split('.').pop() : void 0;
        const fieldVal = match ? match[1] : void 0;
        const uniqueKey = this.model && this.model.uniqueKeys[fieldKey];
        if (uniqueKey) {
          if (uniqueKey.msg) { message = uniqueKey.msg; }
          fields = _.zipObject(uniqueKey.fields, values);
        } else {
          fields[fieldKey] = fieldVal;
        }
        const errors = [];
        _.forOwn(fields, (value, field) => {
          errors.push(new sequelizeErrors.ValidationErrorItem(this.getUniqueConstraintErrorMessage(field), 'unique violation', field, value, this.instance, 'not_unique'));
        });
        return new sequelizeErrors.UniqueConstraintError({ message, errors, parent: err, fields, stack: errStack });
      }
      case ER_ROW_IS_REFERENCED:
      case ER_NO_REFERENCED_ROW: {
        const match = err.message.match(/CONSTRAINT ([`"])(.*)\1 FOREIGN KEY \(\1(.*)\1\) REFERENCES \1(.*)\1 \(\1(.*)\1\)/);
        const quoteChar = match ? match[1] : '`';
        const fields = match ? match[3].split(new RegExp(`${quoteChar}, *${quoteChar}`)) : void 0;
        return new sequelizeErrors.ForeignKeyConstraintError({
          reltype: String(errCode) === String(ER_ROW_IS_REFERENCED) ? 'parent' : 'child',
          table: match ? match[4] : void 0,
          fields,
          value: fields && fields.length && this.instance && this.instance[fields[0]] || void 0,
          index: match ? match[2] : void 0,
          parent: err,
          stack: errStack,
        });
      }
      default:
        return new sequelizeErrors.DatabaseError(err, { stack: errStack });
    }
  }
  handleShowIndexesQuery(data) {
    data = data.rows.reduce((acc, item) => {
      if (!(item.Key_name in acc)) {
        acc[item.Key_name] = item;
        item.fields = [];
      }
      acc[item.Key_name].fields[item.Seq_in_index - 1] = {
        attribute: item.Column_name,
        length: item.Sub_part || void 0,
        order: item.Collation === 'A' ? 'ASC' : void 0,
      };
      delete item.column_name;
      return acc;
    }, {});
    return _.map(data, item => ({
      primary: item.Key_name === 'PRIMARY',
      fields: item.fields,
      name: item.Key_name,
      tableName: item.Table,
      unique: item.Non_unique !== 1,
      type: item.Index_type,
    }));
  }
}
module.exports = Query;
module.exports.Query = Query;
module.exports.default = Query;
// # sourceMappingURL=query.js.map
