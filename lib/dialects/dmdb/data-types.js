"use strict";
const wkx = require("wkx");
const _ = require("lodash");
const momentTz = require("moment-timezone");
const moment = require("moment");
module.exports = (BaseTypes) => {
  BaseTypes.ABSTRACT.prototype.dialectTypes = "https://eco.dameng.com/docs/zh-cn/sql-dev/dmpl-sql-datatype.html";
  BaseTypes.DATE.types.dm = ["TIMESTAMP"];
  BaseTypes.STRING.types.dm = ["VAR_STRING"];
  BaseTypes.CHAR.types.dm = ["STRING"];
  BaseTypes.TEXT.types.dm = ["BLOB"];
  BaseTypes.TINYINT.types.dm = ["TINY"];
  BaseTypes.SMALLINT.types.dm = ["SHORT"];
  BaseTypes.MEDIUMINT.types.dm = ["INT24"];
  BaseTypes.INTEGER.types.dm = ["LONG"];
  BaseTypes.BIGINT.types.dm = ["LONGLONG"];
  BaseTypes.FLOAT.types.dm = ["FLOAT"];
  BaseTypes.TIME.types.dm = ["TIME"];
  BaseTypes.DATEONLY.types.dm = ["DATE"];
  BaseTypes.BOOLEAN.types.dm = ["TINY"];
  BaseTypes.BLOB.types.dm = ["TINYBLOB", "BLOB", "LONGBLOB"];
  BaseTypes.DECIMAL.types.dm = ["NEWDECIMAL"];
  BaseTypes.UUID.types.dm = false;
  BaseTypes.ENUM.types.dm = false;
  BaseTypes.REAL.types.dm = ["DOUBLE"];
  BaseTypes.DOUBLE.types.dm = ["DOUBLE"];
  BaseTypes.GEOMETRY.types.dm = ["GEOMETRY"];
  BaseTypes.JSON.types.dm = ["JSON"];
  class DECIMAL extends BaseTypes.DECIMAL {
    toSql() {
      let definition = super.toSql();
      if (this._unsigned) {
        definition += " UNSIGNED";
      }
      if (this._zerofill) {
        definition += " ZEROFILL";
      }
      return definition;
    }
  }
  class DATE extends BaseTypes.DATE {
    toSql() {
      return this._length ? `TIMESTAMP(${this._length})` : "TIMESTAMP";
    }
    _stringify(date, options) {
      if (!moment.isMoment(date)) {
        date = this._applyTimezone(date, options);
      }
      if (this._length) {
        return date.format(`YYYY-MM-DD HH:mm:ss.${new Array(this._length).fill("S").join()}`);
      }
      return date.format("YYYY-MM-DD HH:mm:ss");
    }
    static parse(value, options) {
      value = value.string();
      if (value === null) {
        return value;
      }
      if (momentTz.tz.zone(options.timezone)) {
        value = momentTz.tz(value, options.timezone).toDate();
      } else {
        value = new Date(`${value} ${options.timezone}`);
      }
      return value;
    }
  }
  class DATEONLY extends BaseTypes.DATEONLY {
    static parse(value) {
      return value.string();
    }
  }
  class TIME extends BaseTypes.TIME {
    toSql() {
      return `TIME${this._length ? `(${this._length})` : ""}`;
    }
    _stringify(date, options) {
      if (!moment.isMoment(date)) {
        date = this._applyTimezone(date, options);
      }
      if (this._length) {
        return date.format(`HH:mm:ss.${new Array(this._length).fill("S").join("")}`);
      }
      return date.format("HH:mm:ss");
    }
  }
  class UUID extends BaseTypes.UUID {
    toSql() {
      return "CHAR(36) BINARY";
    }
  }
  const SUPPORTED_GEOMETRY_TYPES = ["POINT", "LINESTRING", "POLYGON"];
  class GEOMETRY extends BaseTypes.GEOMETRY {
    constructor(type, srid) {
      super(type, srid);
      if (_.isEmpty(this.type)) {
        this.sqlType = this.key;
        return;
      }
      if (SUPPORTED_GEOMETRY_TYPES.includes(this.type)) {
        this.sqlType = this.type;
        return;
      }
      throw new Error(`Supported geometry types are: ${SUPPORTED_GEOMETRY_TYPES.join(", ")}`);
    }
    static parse(value) {
      value = value.buffer();
      if (!value || value.length === 0) {
        return null;
      }
      value = value.slice(4);
      return wkx.Geometry.parse(value).toGeoJSON({ shortCrs: true });
    }
    toSql() {
      return this.sqlType;
    }
  }
  class ENUM extends BaseTypes.ENUM {
    toSql(options) {
      return `ENUM(${this.values.map((value) => options.escape(value)).join(", ")})`;
    }
  }
  class JSONTYPE extends BaseTypes.JSON {
    _stringify(value, options) {
      return options.operation === "where" && typeof value === "string" ? value : JSON.stringify(value);
    }
  }
  class BOOLEAN extends BaseTypes.BOOLEAN {
    toSql() {
      return "BIT";
    }
  }
  return {
    ENUM,
    DATE,
    DATEONLY,
    TIME,
    UUID,
    GEOMETRY,
    DECIMAL,
    JSON: JSONTYPE,
    BOOLEAN
  };
};
//# sourceMappingURL=data-types.js.map
