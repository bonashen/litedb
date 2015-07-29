//this is json database support crud,stored,trigger

'use strict';

var fs = require("fs");
var merge = require('merge');
var path = require('path');
var nutil = require("util");
var meld = require("meld");
var uuid = require('node-uuid');
var emitter = require("events").EventEmitter;
var jsonquery = require("jsonquery");
var Stream = require("stream");
var indexOf = require("indexof");
var each = require("foreach");
var total = require("stream-total");


var Db = {
	events: new emitter()
};
(function() {
	var util = {
		isArray: nutil.isArray,
		isFunction: nutil.isFunction,
		isObject: nutil.isObject,
		isValidPath: function(path) {
			return fs.existsSync(path);
		},
		writeToFile: function(file, content) {
			if (!content) {
				content = [];
			}
			fs.writeFileSync(file, JSON.stringify(content, null, 0));
		},
		readFromFile: function(file) {
			return fs.readFileSync(file, 'utf-8');
		},
		removeFile: function(file) {
			return fs.unlinkSync(file);
		},
		uuid: function() {
			return uuid.v4().replace(/-/g, '');
		},
		initialToUpperCase: function(it) {
			return it.replace(/(\w)/,
				function(s) {
					return s.toUpperCase(); //转换首字母为大写并返回
				});
		},
		getObjects: function(objectType) {
			var ret = [];
			each(Db, function(value) {
				if (value instanceof objectType) {
					ret.push(value);
				}
			});

			return ret;
		},
		hitch: function(scope, method) {
			return function() {
				return scope[method].apply(scope, arguments || []);
			};
		}

	};

	//Db.connect("db",["User"])
	Db.connect = function(dbPath, collections) {
        var self = this;
        if(!self._db &&(!util.isValidPath(path.join(dbPath)))) throw Error("dbPath:" + dbPath + " is not valid!");
		var db = {
			path: dbPath,
			storages: []
		};
        if(self._db&&!collections){
            collections = dbPath;
        }
		db = self._db = self._db||db;

		var emit = self.util.emit;

		function loadConnections(collections) {
			if (typeof collections === 'object' && collections.length) {
				for (var i = 0; i < collections.length; i++) {
					var p = path.join(db.path, (collections[i].indexOf('.json') >= 0 ? collections[i] : collections[i] + '.json'));
					var _c = collections[i].replace('.json', '');
					if (self[_c]) continue;
					if (!util.isValidPath(p)) util.writeToFile(p);
					var o = self[_c] = new Collection(_c);
					o._f = p;
					o.storage = Db.getStorage(o);
					Db._db.storages.push(o.storage);
					o.storage.read();
					emit("db/collectionLoad", o);
					assembleTrigger(o);
				}
			}

		}

		function assembleTrigger(collection) {
			if (!db.meta) return;
			var triggers = db.meta.triggers;
			if (triggers[collection.name]) {
				each(triggers[collection.name], function(tc) {
					tc.trigger.assemble(collection, tc.triggerType);
				});
			}
		}

		function loadMeta() {
			if (db.metaFile) return;
			var p = path.join(db.path, ".meta");
			db.metaFile = p;
			if (!util.isValidPath(p)) {
				util.writeToFile(p, {
					stored: [],
					trigger: []
				});
			}
			db.meta = JSON.parse(util.readFromFile(p));
			analyseMeta();
			emit("db/loadMeta", db.meta);
		}

		function analyseMeta() {
			if (db.meta) {
				var meta = db.meta;
				each(meta.stored, function(o) {
					Db.util.stored(o.name, eval("(" + o.exec + ")"));
				});

				meta.triggers = {};
				each(meta.trigger, function(o) {
					var trigger = Db.util.trigger(o.name, eval("(" + o.exec + ")"));
					each(o.collections, function(item) {
						var tc = meta.triggers[item.collection] = meta.triggers[item.collection] || [];
						tc.push({
							trigger: trigger,
							triggerType: item.triggerType
						});
					});
				});

				delete meta.stored;
				delete meta.trigger;
			}

		}

		loadMeta();
		loadConnections(collections);

		return this;
	};

	Db.storeData = function() {
		var emit = this.util.emit;

		function storeCollections() {
			Db._db.storages.forEach(function(storage) {
				storage.write();
			});
			emit("db/collectionsStore");
		}

		function storeMeta() {
			var meta = Db._db.meta = {
				stored: [],
				trigger: []
			};
			each(Db.util.getStoreds(), function(o) {
				meta.stored.push({
					name: o.name,
					exec: o.exec.toString()
				});
			});


			each(Db.util.getTriggers(), function(o) {
				var t = {
					name: o.name,
					exec: o.exec.toString(),
					collections: []
				};
				meta.trigger.push(t);
				each(o.cns, function(value, key) {
					t.collections.push({
						collection: key,
						triggerType: value.triggerType
					});
				});
			});


			meta.modifyDate = new Date();
			util.writeToFile(Db._db.metaFile, meta);
			emit("db/metaStore", meta);

		}
		storeMeta();
		storeCollections();
	};

	Db.util = {};

	Db.getStorage = function(collection) {
		return new Storage(collection);
	};

	//获取或创建存储功能
	Db.util.stored = function(name, exec) {
		return Db[name] || new Stored(name, exec);
	};
	//获取或创建触发器
	//Db.utils.trigger("beforeUserSaveTrigger",function(entity){});
	Db.util.trigger = function(name, exec) {
		return Db[name] || new Trigger(name, exec);
	};

	Db.util.emit = function(eventName) {
		var args = [];

		each(arguments, function(arg) {
			args.push(arg);
		});

		Db.events.emit.apply(Db.events, args);
	};


	Db.util.getCollections = function() {
		return util.getObjects(Collection)
	};
	Db.util.getStoreds = function() {
		return util.getObjects(Stored)
	};
	Db.util.getTriggers = function() {
		return util.getObjects(Trigger)
	};


	function Collection(collectionName) {
		this.name = collectionName;
		this.data = [];
		var emit = this.emit = Db.util.emit;

		var self = this;

		function init() {
			var value = null;
			for (var key in self) { //切面，在每个原型方法调用前发送相应的事件
				value = self[key];
				if (!self.hasOwnProperty(key) && util.isFunction(value)) {
					(function(key) {
						var eventName = "collection/on" + util.initialToUpperCase(key);
						meld.on(self, key, function() {
							emit(eventName, {
								sender: self,
								args: arguments
							});
						});
					})(key);
				}
			}


			self.beforeSaveTrigger = self.afterSaveTrigger = function(entity) {};

			self.beforeUpdateTrigger = self.afterUpdateTrigger = function(origEntity, newEntity) {};

			self.beforeRemoveTrigger = self.afterRemoveTrigger = function(entity) {};

		}

		init();
	};

	Collection.prototype.save = function(entities) {
		if (!util.isArray(entities)) entities = [entities];
		var self = this;
		each(entities, function(entity) {
			self.beforeSaveTrigger(entity);
			self.data.push(merge({
				_id: util.uuid()
			}, entity));
			self.afterSaveTrigger(entity);
		});

	};

	Collection.prototype.update = function(filter, entity, multi) {
		var searcher = new Searcher(this);
		var self = this;
		searcher.query(filter, multi).forEach(function(o) {
			self.beforeUpdateTrigger(o, entity);
			merge(o, entity);
			self.afterUpdateTrigger(o, entity);
		});
		return searcher.result;
	};

	Collection.prototype.remove = function(query, multi) {
		var self = this;

		function removeOne(o) {
			self.beforeRemoveTrigger(o);
			self.data.splice(indexOf(self.data, o), 1);
			self.afterRemoveTrigger(o);
		}

		function removeAll() {
			var datas = self.data.slice();
			datas.forEach(function(o) {
				removeOne(o);
			});
			delete Db[self.name];
			Db._db.storages.splice(indexOf(self.storage), 1);
			util.removeFile(self._f);
			return datas;
		}
		if (arguments.length == 0) return removeAll();
		var searcher = new Searcher(self);
		searcher.query(query, multi).forEach(function(o) {
			removeOne(o);
		});
		return searcher.result;
	};

	Collection.prototype.find = function(query) {
		if (!query) return this.data;
		var searcher = new Searcher(this);
		return searcher.query(query, true);
	};

	Collection.prototype.findOne = function(query) {
		if (!query && this.data.length) return this.data[0];
		var searcher = new Searcher(this);
		var ret = searcher.query(query, false);
		return ret.length ? ret[0] : null;
	};

	Collection.prototype.count = function(query) {
		if (query) {
			var searcher = new Searcher(this);
			var ret = searcher.query(query);
			return ret.length;
		}
		return this.data.length;
	};

	Collection.prototype.orderBy = function(names, query) {
		names = names.split(",");
		var data = merge.clone(this.data);
		if (query) data = this.find(query);
		var comparer = function(a, b) {
			var ret = 0;
			for (var i = 0; i < names.length; i++) {
				var label = names[i],
					x = a[label],
					y = b[label];
				if (ret == 0) {
					ret = x < y ? -1 : x > y ? 1 : 0;
				} else break;
			}
			return ret;
		};
		return data.sort(comparer);
	};

	Collection.prototype.all = function(query) {
		return this.count(query) > 0;
	};

	Collection.prototype.first = function(query) {
		return this.findOne(query);
	};

	Collection.prototype.last = function(query) {
		var ret = this.find(query);
		if (ret.length) return ret[ret.length - 1];
		return null;
	};

	Collection.prototype.distinct = function(name, query, distinctValue) {
		var data = this.data;
		if (!query) data = merge.clone(data);
		else data = this.find(query);
		distinctValue = distinctValue || false;
		var d_item;
		var dict = {};
		var retVal = [];
		var self = this;
		this.each(function(item, index) {
			d_item = item[name];
			if (dict[d_item] == null) {
				dict[d_item] = true;
				retVal[retVal.length] = distinctValue ? d_item : item;
			}
		});
		dict = null;
		return retVal;
	};

	Collection.prototype.union = function(second, distinctName) {
		var data = merge.clone(this.data);
		return util.hitch({
			data: data.concat(second)
		}, this.distinct)(distinctName, null, null);

	};

	Collection.prototype.intersect = function(second, distinctName) {
		var data = merge.clone(this.data);
		var collection = {
				data: data
			},
			distinct = util.hitch(collection, this.distinct);
		var result, map = {};
		var leftq = data,
			rightq = second;
		if (leftq.length > rightq.length) { //挑选较多的fromq为标靶，提高效率
			var tmp = leftq;
			leftq = rightq;
			rightq = tmp;
			collection.data = leftq;
		}
		each(rightq, function(item, index) { //布置标靶，去除重复项
			map[item[distinctName]] = item;
		});
		leftq = distinct(distinctName, null, true); //删除重复项,并返回项唯一值
		result = [];
		each(leftq, function(item, index) {
			if (map[item]) result.push(map[item]); //打靶
		});
		map = null;
		return result;
	};

	Collection.prototype.except = function(second, distinctName) {
		//下面代码是通过遍历aq,删除重复项，
		//取出bq中唯一值对象，若在aq中标中，则不选择并删除aq中的值。
		var data = merge.clone(this.data);
		var collection = {
				data: data
			},
			distinct = util.hitch(collection, this.distinct);

		var m = {},
			ret = [],
			dis;

		var aq = data,
			bq = second;
		if (aq.length < bq.length) { //挑选元素量较多的fromq作为标靶，提高效率
			aq = bq;
			bq = data;
		}
		each(aq, //找出唯一值对象，设置标靶
			function(item, index) {
				dis = item[distinctName];
				m[dis] = item;
			}
		);
		collection.data = bq;

		var tmp = distinct(distinctName); //删除重复项
		each(tmp, function(item, index) { //选择未在m靶中出现的值，若出现将标识为undefined.
			dis = item[distinctName];
			if (m[dis] !== undefined) { //打靶
				delete m[dis]; //删除出现项
				return; //过滤该项
			}
			ret.push(item);
		});
		each(m,function(value,key){//插入未标识undefined的对象
			ret.push(value);
		});
		
		return ret;
	};

	Collection.prototype.pipe = function(dest) {
		var s = new Stream;
		s.readable = true;
		s.pipe(dest);
		var datas = this.data.slice().reverse();

		function next() {
			var data = datas.pop();
			if (data) {
				s.emit('data', data);
				process.nextTick(next);
			} else {
				s.emit('end');
			}
		}
		process.nextTick(next);
		return dest;
	};

    Collection.prototype.total = function(template,query){
        var data = this.data;
        if (!query) data = merge.clone(data);
        else data = this.find(query);
        return total(template).readArray(data);
    };

	function Trigger(name, exec) {
		this.name = name;
		this.exec = exec || function() {};
		Db[name] = this;
		this.emit = Db.util.emit;
		//store collection trigger's remover.
		this.cns = {};
	};
	//Db.beforeUserSaveTrigger.assemble(Db.users,"beforeSaveTrigger");
	Trigger.prototype.assemble = function(collection, triggerType) {
		var o = this.cns[collection.name];
		if (o) return o;
		var self = this;
		o = this.cns[collection.name] = meld.before(collection, triggerType, function() {
			if (util.isFunction(self.exec)) self.exec.apply(this, arguments);
		});
		o.triggerType = triggerType;
		this.emit("trigger/assemble", {
			sender: this,
			collection: collection,
			triggerType: triggerType
		});
		return o;
	};
	//Db.beforeUserSaveTrigger.drop();
	//Db.beforeUserSaveTrigger.drop(Db.users);
	Trigger.prototype.drop = function(collections) {
		var self = this;

		function dropCollection(collection) {
			if (util.isObject(collection)) collection = collection.name;
			var remover = self.cns[collection];
			if (remover) {
				remover.remove();
				delete self.cns[collection];
				self.emit("trigger/drop", {
					sender: self,
					collection: Db[collection],
					triggerType: remover.triggerType
				});
			}
		}
		var droped = false;

		if (!collections) {
			droped = true;
			collections = [];
			each(self.cns, function(value, key) {
				collections.push(key);
			});
		}

		if (!util.isArray(collections)) collections = [collections];

		each(collections, dropCollection);

		if (droped) {
			delete Db[self.name];
			self.emit("trigger/drop", {
				sender: self
			});
		}

	};
	//for stored functions.
	function Stored(name, exec) {
		Db[name] = this;
		this.name = name;
		this.exec = exec;
	};

	Stored.prototype.drop = function() {
		delete Db[this.name];
	};

	function Storage(collection) {
		this.emit = collection.emit;
		this.collection = collection;
		this._f = collection._f;

	};

	Storage.prototype.read = function() {

		var data = this.collection.data = JSON.parse(util.readFromFile(this._f));
		var self = this;
		self.emit("storage/read", {
			collection: self.collection,
			data: data,
			sender: self
		});
		return data;
	};

	Storage.prototype.write = function() {
		util.writeToFile(this._f, this.collection.data);
		var self = this;
		self.emit("storage/write", {
			collectionName: self.collection,
			data: self.collection.data,
			sender: self
		});
	};

	function Searcher(collection) {
		this.collection = collection;
		this.result = [];
	};

	Searcher.prototype.query = function(query, multi) {
		var self = this;
		self.result = [];
		var looped = true;
		var stream = jsonquery(query);
		stream.on("data", function(doc) {
			self.result.push(doc);
			if (!multi) looped = false;
		});
		self.collection.data.every(function(data) {
			stream.write(data);
			return looped;
		});
		stream.end();
		self.result = merge.clone(self.result);
		return self.result;
	};
})();
module.exports = Db;
