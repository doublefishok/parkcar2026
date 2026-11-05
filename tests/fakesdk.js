/* 极简 wx-server-sdk 模拟：仅覆盖云函数用到的 API */
let SEQ = 1000;
const store = {};
const OPENID = { value: 'renter-openid' };

const _ = {
  in: v => ({ __op: 'in', v }),
  neq: v => ({ __op: 'neq', v }),
  lt: v => ({ __op: 'lt', v })
};

function matchOne(val, cond) {
  if (cond && typeof cond === 'object' && cond.__op) {
    switch (cond.__op) {
      case 'in': return cond.v.indexOf(val) >= 0;
      case 'neq': return val !== cond.v;
      case 'lt': return val < cond.v;
    }
  }
  return val === cond;
}
function matches(doc, cond) {
  return Object.keys(cond || {}).every(k => matchOne(doc[k], cond[k]));
}

function Collection(name) {
  if (!store[name]) store[name] = [];
  this.name = name;
}
Collection.prototype.where = function (cond) { return new Query(this.name, cond); };
Collection.prototype.limit = function () { return new Query(this.name, {}); };
Collection.prototype.get = function () { return new Query(this.name, {}).get(); };
Collection.prototype.count = function () { return new Query(this.name, {}).count(); };
Collection.prototype.orderBy = function (f, d) { const q = new Query(this.name, {}); return q.orderBy(f, d); };
Collection.prototype.add = async function (opt) {
  const _id = 'id' + (++SEQ);
  store[this.name].push(Object.assign({ _id }, opt.data));
  return { _id };
};
Collection.prototype.doc = function (id) {
  const name = this.name;
  return {
    get: async () => {
      const d = store[name].find(x => x._id === id);
      if (!d) throw new Error('document not found');
      return { data: JSON.parse(JSON.stringify(d)) };
    },
    update: async (opt) => {
      const d = store[name].find(x => x._id === id);
      if (d) Object.assign(d, opt.data);
      return { stats: { updated: d ? 1 : 0 } };
    },
    set: async (opt) => {
      const i = store[name].findIndex(x => x._id === id);
      const doc = Object.assign({ _id: id }, opt.data);
      if (i >= 0) store[name][i] = doc; else store[name].push(doc);
      return { stats: { updated: 1 } };
    }
  };
};

function Query(name, cond) {
  this.name = name; this.cond = cond || {}; this._limit = 100; this._skip = 0; this._order = null;
}
Query.prototype.where = function (c) { const q = new Query(this.name, c); q._limit = this._limit; return q; };
Query.prototype.limit = function (n) { this._limit = n; return this; };
Query.prototype.skip = function (n) { this._skip = n; return this; };
Query.prototype.orderBy = function (f, d) { this._order = [f, d || 'asc']; return this; };
Query.prototype._rows = function () {
  if (!store[this.name]) store[this.name] = [];
  let rows = store[this.name].filter(d => matches(d, this.cond));
  if (this._order) {
    const [f, d] = this._order;
    rows = rows.slice().sort((a, b) => (a[f] > b[f] ? 1 : a[f] < b[f] ? -1 : 0) * (d === 'desc' ? -1 : 1));
  }
  return rows.slice(this._skip, this._skip + this._limit).map(r => JSON.parse(JSON.stringify(r)));
};
Query.prototype.get = async function () { return { data: this._rows() }; };
Query.prototype.count = async function () { return { total: store[this.name].filter(d => matches(d, this.cond)).length }; };
Query.prototype.update = async function (opt) {
  const rows = store[this.name].filter(d => matches(d, this.cond));
  rows.forEach(d => Object.assign(d, opt.data));
  return { stats: { updated: rows.length } };
};
Query.prototype.remove = async function () {
  const before = store[this.name].length;
  store[this.name] = store[this.name].filter(d => !matches(d, this.cond));
  return { stats: { removed: before - store[this.name].length } };
};

const cloud = {
  DYNAMIC_CURRENT_ENV: 'test-env',
  init() {},
  getWXContext() { return { OPENID: OPENID.value, APPID: 'testapp' }; },
  database() { return { collection: n => new Collection(n), command: _ }; },
  openapi: {
    subscribeMessage: {
      send: async (opts) => {
        if (!cloud.__sent) cloud.__sent = [];
        cloud.__sent.push(opts);
        return { errCode: 0, errMsg: 'ok' };
      }
    }
  },
  __sent: [],
  __store: store,
  __setOpenid(o) { OPENID.value = o; },
  __seed(name, arr) { store[name] = arr; }
};
module.exports = cloud;
