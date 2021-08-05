/*!
 * @module report
 * @author kael, chriscai
 * @date @DATE
 * Copyright (c) 2014 kael, chriscai
 * Licensed under the MIT license.
 */

// 1. 初始化 ------ BJ_REPORT.init() -------- report.init()
// 2. 手动上报 ---- BJ_REPORT.report() ------ report.report()
var BJ_REPORT = (function(global) {
    if (global.BJ_REPORT) return global.BJ_REPORT;
    // 将BJ_REPORT绑定到global对象上，浏览器中是 window

    var _log_list = [];
    var _log_map = {};
    var _config = {
        id: 0, // 上报 id
        uin: 0, // user id
        url: "", // 上报 接口
        offline_url: "", // 离线日志上报 接口
        offline_auto_url: "", // 检测是否自动上报
        ext: null, // 扩展参数 用于自定义上报
        level: 4, // 错误级别 1-debug 2-info 4-error
        ignore: [], // 忽略某个错误, 支持 Regexp 和 Function
        random: 1, // 抽样 (0-1] 1-全量
        delay: 1000, // 延迟上报 combo 为 true 时有效
        submit: null, // 自定义上报方式
        repeat: 5, // 重复上报次数(对于同一个错误超过多少次不上报),
        offlineLog: false,
        offlineLogExp: 5,  // 离线日志过期时间 ， 默认5天
        offlineLogAuto: false,  //是否自动询问服务器需要自动上报
    };

    // Offline_DB
    var Offline_DB = {
        db: null,
        ready: function(callback) {
        // ready
        // - 主要作用：打开数据库并设置success和upgradeneeded监听事件
            var self = this;
            if (!window.indexedDB || !_config.offlineLog) {
                _config.offlineLog = false;
                return callback();
            }

            if (this.db) {
                setTimeout(function() {
                    callback(null, self);
                }, 0);

                return;
            }
            var version = 1;

            var request = window.indexedDB.open("badjs", version); // 打开数据库
            // window.indexedDB.open(name, version)
            // 1. 作用
            // - 打开数据库
            // - open 请求不会立即打开数据库或者开始一个事务
            // 2. 说明
            // - 如果数据库不存在，open 操作会创建该数据库，然后 ( onupgradeneeded ) 事件被触发，你需要在该事件的处理函数中创建数据库模式
            // - 果数据库已经存在，但你指定了一个更高的数据库版本，会直接触发 ( onupgradeneeded ) 事件，允许你在处理函数中更新数据库模式。
            // 3. 参数
            // - name 数据库名
            // - version 数据库版本号，数据库的版本决定了数据库架构，即数据库的对象仓库（object store）和他的结构
            // 4
            // - IndexedDB 的主要设计目标之一就是允许大量数据可以被存储以供离线使用

            if (!request) {
                _config.offlineLog = false;
                return callback();
            }

            request.onerror = function(e) { // 打开失败
                callback(e);
                _config.offlineLog = false;
                console.log("indexdb request error");
                return true;
            };
            request.onsuccess = function(e) { // 打开成功
                self.db = e.target.result;

                setTimeout(function() {
                    callback(null, self);
                }, 500);


            };
            request.onupgradeneeded = function(e) { // 版本升级（初始化时会先触发upgradeneeded，再触发success）
                var db = e.target.result;
                if (!db.objectStoreNames.contains('logs')) {
                    db.createObjectStore('logs', { autoIncrement: true }); // 为该数据库，创建一个对象仓库
                }
            };
        },
        insertToDB: function(log) {
            var store = this.getStore();
            store.add(log);
        },
        addLog: function(log) {
            if (!this.db) {
                return;
            }
            this.insertToDB(log);
        },
        addLogs: function(logs) {
            if (!this.db) {
                return;
            }

            for (var i = 0; i < logs.length; i++) {
                this.addLog(logs[i]);
            }

        },
        getLogs: function(opt, callback) {
            if (!this.db) {
                return;
            }
            var store = this.getStore();
            var request = store.openCursor();
            var result = [];
            request.onsuccess = function(event) {
                var cursor = event.target.result;
                if (cursor) {
                    if (cursor.value.time >= opt.start && cursor.value.time <= opt.end && cursor.value.id == opt.id && cursor.value.uin == opt.uin) {
                        result.push(cursor.value);
                    }
                    //# cursor.continue
                    cursor["continue"]();
                } else {
                    callback(null, result);
                }
            };

            request.onerror = function(e) {
                callback(e);
                return true;
            };
        },
        clearDB: function(daysToMaintain) {
            if (!this.db) {
                return;
            }

            var store = this.getStore();
            if (!daysToMaintain) {
                store.clear();
                return;
            }
            var range = (Date.now() - (daysToMaintain || 2) * 24 * 3600 * 1000);
            var request = store.openCursor();
            request.onsuccess = function(event) {
                var cursor = event.target.result;
                if (cursor && (cursor.value.time < range || !cursor.value.time)) {
                    store["delete"](cursor.primaryKey);
                    cursor["continue"]();
                }
            };
        },

        getStore: function() {
            var transaction = this.db.transaction("logs", 'readwrite');
            return transaction.objectStore("logs");
        },

    };

    // T
    var T = {
        isOBJByType: function(o, type) {
            return Object.prototype.toString.call(o) === "[object " + (type || "Object") + "]";
        },

        isOBJ: function(obj) {
            var type = typeof obj;
            return type === "object" && !!obj;
            // 1. type === 'object' =====================> array object null
            // 2. !!null ================================> false
            // 3. type === "object" && !!obj ============> array object
        },
        isEmpty: function(obj) {
            if (obj === null) return true; // null 返回false
            if (T.isOBJByType(obj, "Number")) {
                return false; // number 返回false
            }
            return !obj; // 取反
        },
        // extend
        extend: function(src, source) {
            for (var key in source) {
                src[key] = source[key];
            }
            return src;
        },

        // 1
        // BJ_REPORT.report("error msg");

        // 2
        // BJ_REPORT.report({
        // msg: "xx load error",                 // 错误信息
        // target: "xxx.js",                     // 错误的来源js
        // rowNum: 100,                          // 错误的行数
        // colNum: 100,                          // 错误的列数
        // });

        // 3
        // BJ_REPORT.report(new Error('xxx'));

        processError: function(errObj) { // obj 的两种情况
            try {
                if (errObj.stack) { // error实例上的stack属性，上面的第 2 种情况是没有stack的
                    // 真实的 error.stack 是下面这样的字符串
                    var url = errObj.stack.match("https?://[^\n]+");
                    // url  eg：[ 'Error: 错误', index: 0, input: 'Error: 错误\n' + '    at throwit (/Users/admin/work_space/other/small-test/error/index.js:2:9)\n'”
                    // url 线上环境则会包含 http 或者 https

                    url = url ? url[0] : ""; // match匹配成功返回的是一个数组，所以存在[0]就是匹配到的字符串

                    var rowCols = url.match(":(\\d+):( \\d+)"); // 匹配这样的字符串：':2:9'
                    // rowCols  eg: index.js:2:9 => [":2:9", "2", "9", index: 8, input: "index.js:2:9", groups: undefined]

                    if (!rowCols) {
                        rowCols = [0, 0, 0]; // 错误的 row col 信息
                    }

                    var stack = T.processStackMsg(errObj)
                    // stack = 返回转换后的stack字符串 - 去errorObj.stack的-掉换行符，@替换at，并截取前9条栈信息，去掉？字符海岸等

                    return {
                        msg: stack,
                        rowNum: rowCols[1], // row信息
                        colNum: rowCols[2], // col信息
                        target: url.replace(rowCols[0], ""), // 错误文件的文件路径父路径
                        _orgMsg: errObj.toString() // 源
                    };
                } else {
                    //ie 独有 error 对象信息，try-catch 捕获到错误信息传过来，造成没有msg
                    if (errObj.name && errObj.message && errObj.description) {
                        return {
                            msg: JSON.stringify(errObj)
                        };
                    }
                    return errObj;
                }
            } catch (err) {
                return errObj;
            }
        },

        processStackMsg: function(error) {
            // 1
            // error.stack
            // 真实的 error.stack 是类似下面这样的字符串
            // Error
            //    at throwit (~/examples/throwcatch.js:9:11)
            //    at catchit (~/examples/throwcatch.js:3:9)
            //    at repl:1:5

            var stack = error.stack
                .replace(/\n/gi, "") // 去掉所有换行符
                .split(/\bat\b/) // 通过 'at' 分割成数组
                .slice(0, 9) // 截取数据前9个成员，即截取调用栈中的前9个栈关系数据
                .join("@") // 其实就是将 ’at‘ 转换成 @
                .replace(/\?[^:]+/gi, ""); // 去掉？后的字符串
            var msg = error.toString();
            if (stack.indexOf(msg) < 0) {
                stack = msg + "@" + stack;
                // eg  new Error('错误').toString() => "Error: 错误"
                // 不存在错误的提示信息，就组装
            }
            return stack;
            // 返回转换后的stack字符串 - 去掉换行符，@替换at，并截取前9条栈信息，去掉？字符海岸等
        },

        isRepeat: function(error) {
            if (!T.isOBJ(error)) return true; // 不是一个对象，返回true
            var msg = error.msg;
            var times = _log_map[msg] = (parseInt(_log_map[msg], 10) || 0) + 1;
            // 第一次：
            // parseInt(_log_map[msg], 10) => parseInt(undefined, 10) => NaN
            // NaN || 0 返回 0
            // times = _log_map[msg] = 1
            // 第二次
            // parseInt(1, 10) => 1
            // times = _log_map[msg]  = 2

            return times > _config.repeat;
            // _config.repeat 重复上报次数(对于同一个错误超过多少次不上报)，是在init(config)的配置对象中传入的
        }
    };


    var orgError = global.onerror;
    // rewrite window.onerror
    // 重写 window.onerror
    global.onerror = function(msg, url, line, col, error) {
        // msg string 错误信息
        // url string 发生错误脚本的url=source
        // line number 发生错误的行号
        // col number 发生错误的列号
        // error Error 错误对象
        var newMsg = msg;

        if (error && error.stack) {
            newMsg = T.processStackMsg(error);
        }

        if (T.isOBJByType(newMsg, "Event")) { // 初始化时，不进入if，newMsg不是Event对象
            newMsg += newMsg.type ?
                ("--" + newMsg.type + "--" + (newMsg.target ?
                    (newMsg.target.tagName + "::" + newMsg.target.src) : "")) : "";
        }

        report.push({
            msg: newMsg,
            target: url,
            rowNum: line,
            colNum: col,
            _orgMsg: msg
        });

        _process_log(); // 上报

        orgError && orgError.apply(global, arguments);
        // orgError 表示原生的 global.onerror
    };



    var _report_log_tostring = function(error, index) {
        var param = [];
        var params = [];
        var stringify = []; // error对象属性的: key:value的字符串形式
        if (T.isOBJ(error)) { // 对象
            error.level = error.level || _config.level;
            // 默认值是 level: 4
            // 错误级别 1-debug 2-info 4-error
            for (var key in error) {
                var value = error[key];
                if (!T.isEmpty(value)) {
                    if (T.isOBJ(value)) {
                        try {
                            value = JSON.stringify(value); // 转成字符串
                        } catch (err) {
                            value = "[BJ_REPORT detect value stringify error] " + err.toString();
                        }
                    }
                    stringify.push(key + ":" + value);
                    param.push(key + "=" + encodeURIComponent(value)); // uri的形式
                    params.push(key + "[" + index + "]=" + encodeURIComponent(value));
                }
            }
        }

        // msg[0]=msg&target[0]=target -- combo report
        // msg:msg,target:target -- ignore
        // msg=msg&target=target -- report with out combo
        return [params.join("&"), stringify.join(","), param.join("&")];
    };



    var _offline_buffer = [];

    var _save2Offline = function(key, msgObj) {
        msgObj = T.extend({ id: _config.id, uin: _config.uin, time: new Date - 0 }, msgObj);

        if (Offline_DB.db) {
            Offline_DB.addLog(msgObj);
            return;
        }


        if (!Offline_DB.db && !_offline_buffer.length) {
            Offline_DB.ready(function(err, DB) {
                if (DB) {
                    if (_offline_buffer.length) {
                        DB.addLogs(_offline_buffer);
                        _offline_buffer = [];
                    }

                }
            });
        }
        _offline_buffer.push(msgObj);
    };

    var _autoReportOffline = function() {
        var script = document.createElement("script");

        script.src = _config.offline_auto_url || _config.url.replace(/badjs$/, "offlineAuto") + "?id=" + _config.id + "&uin=" + _config.uin;
        // _config.offline_auto_url 检测是否自动上报

        window._badjsOfflineAuto = function(isReport) {
            if (isReport) {
                BJ_REPORT.reportOfflineLog();
            }
        };

        document.head.appendChild(script);
    };



    var submit_log_list = [];
    var comboTimeout = 0;

    var _submit_log = function() {
        clearTimeout(comboTimeout);
        // https://github.com/BetterJS/badjs-report/issues/34
        comboTimeout = 0;

        if (!submit_log_list.length) {
            return;
        }

        var url = _config._reportUrl + submit_log_list.join("&") + "&count=" + submit_log_list.length + "&_t=" + (+new Date);

        if (_config.submit) {
            _config.submit(url, submit_log_list);
            // 如果存在，表示在init()时，自定义了上报方式
        } else {
            var _img = new Image();
            _img.src = url;
            // 否则，通过 new Image() 的方式上报
        }

        submit_log_list = []; // 上报完清空
    };

    // _process_log
    // 流程：report()上报 => push()到_log_list => _process_log()这里并没有穿参
    // 1
    // _process_log 主要负责上报
    // - 随机上报、忽略上报、离线日志存储和延迟上报
    var _process_log = function(isReportNow) {
        if (!_config._reportUrl) return; // '/badjs?id=1&uin=0&'
        // 1
        // 在 init() 时对 _config 添加了各种属性
        // 2
        // 在 id 存在时，给_config添加了_reportUrl
        // - _reportUrl 表示上报地址
        // - _config._reportUrl = (_config.url || "/badjs") + "?id=" + id + "&uin=" + _config.uin + "&from=" + encodeURIComponent(location.href) + "&";

        var randomIgnore = Math.random() >= _config.random; // 抽样 [0, 1) // 1-全量
        // randomIgnore
        // Math.random() ----- [0, 1)
        // _config.random 默认值是 1 => randomIgnore 默认是false
        // 这里是反过来的
        // 1表示全部上报
        // 0-1表示随机上报，因为判断时取反了


        // _log_ist 中的数据就是类似下面这样 data 或者 newData，注意顺序是 [data,newData]
        // data
        // - data = { msg: stack, rowNum: rowCols[1], colNum: rowCols[2], target: url.replace(rowCols[0], ""), _orgMsg: errObj.toString() }
        // - data.ext
        // - data.from
        // - dada.level
        // newData
        // - msg
        while (_log_list.length) {
            var isIgnore = false; // ++++++++++++++++++++++++++++++标志位
            var report_log = _log_list.shift(); // 抛出队列的第一个值
            //有效保证字符不要过长
            report_log.msg = (report_log.msg + "" || "").substr(0, 500); // stringObject.substr(start,length)

            // 重复上报
            if (T.isRepeat(report_log)) continue;
            // 如果同一类型的error对象的 【 msg 】出现了init()时配置项中config配置的 【 repeat: 5 】配置的次数，就跳过下面的代码


            var log_str = _report_log_tostring(report_log, submit_log_list.length); // 转成字符串
            // log_str
            // 1. 参数
            // - report_log: data 即 error对象
            // - submit_log_list: 数组，初始时是[]
            // 2. 返回值
            // 返回一个数组，成员都string化： [params.join("&"), stringify.join(","), param.join("&")];
            // msg[0]=msg&target[0]=target -- combo report
            // msg:msg,target:target -- ignore
            // msg=msg&target=target -- report with out combo

            if (T.isOBJByType(_config.ignore, "Array")) { // _config.ignore是一个数组，表示忽略某个错误, 支持 Regexp 和 Function
                // _config.ignore 是一个数组
                // 若用户自定义了ignore规则，则按照规则进行筛选
                for (var i = 0, l = _config.ignore.length; i < l; i++) {
                    var rule = _config.ignore[i];
                    if ((T.isOBJByType(rule, "RegExp") && rule.test(log_str[1])) ||
                        (T.isOBJByType(rule, "Function") && rule(report_log, log_str[1]))) {
                        isIgnore = true;// ++++++++++++++++++++++++++++++标志位
                        break;
                    }
                }
            }

            if (!isIgnore) {// ++++++++++++++++++++++++++++++标志位
                // 若离线日志功能已开启，则将日志存入数据库
                _config.offlineLog && _save2Offline("badjs_" + _config.id + _config.uin, report_log);
                if (!randomIgnore && report_log.level != 20) {
                    // 1
                    // level为20表示是offlineLog方法push进来的，只存入离线日志而不上报
                    // 2
                    // randomIgnore 表示随机上报，通过0-1之间数字表示概率

                    submit_log_list.push(log_str[0]);
                    // 若可以上报，则推入submit_log_list，稍后由_submit_log方法来清空该队列并上报

                    _config.onReport && (_config.onReport(_config.id, report_log));
                    // 执行上报回调函数，一般不指定
                }

            }
        }


        if (isReportNow) {
            _submit_log(); // 立即上报
        } else if (!comboTimeout) {
            comboTimeout = setTimeout(_submit_log, _config.delay); // 延迟上报
        }
    };



    var report = global.BJ_REPORT = {
        push: function(msg) { // 将错误推到缓存池

            // msg不是对象，则将msg转成对象
            // msg是对象，则返回 T.processError(msg)，即这样一个对象 { msg: stack, rowNum: rowCols[1], colNum: rowCols[2], target: url.replace(rowCols[0], ""), _orgMsg: errObj.toString() };
            var data = T.isOBJ(msg) ? T.processError(msg) : {
                msg: msg
            };

            // ext 有默认值, 且上报不包含 ext, 使用默认 ext
            // ext 扩展属性，后端做扩展处理属性。例如：存在 msid 就会分发到 monitor,
            if (_config.ext && !data.ext) {
                data.ext = _config.ext;
            }

            // 在错误发生时获取页面链接
            // https://github.com/BetterJS/badjs-report/issues/19
            if (!data.from) {
                data.from = location.href;
            }

            if (data._orgMsg) {
                // data._orgMsg 原始的错误信息，没有经过处理前的数据
                var _orgMsg = data._orgMsg;
                delete data._orgMsg; // 缓存后删除
                data.level = 2; // 定义错误级别, // 2-info
                var newData = T.extend({}, data); // 复制data对象
                newData.level = 4; // 错误级别 // 4-error
                newData.msg = _orgMsg;
                _log_list.push(data);
                _log_list.push(newData); // data 和 newData 只是等级不一样，和添加了一个msg属性指向原错误信息
            } else {
                _log_list.push(data); // 如果不存在，则直接添加到 _log_list
            }

            _process_log();
            return report; // 同样返回 report，则可以实现链式调用
        },

        // 上报 report
        // 1
        // BJ_REPORT.report("error msg");
        // 2
        // BJ_REPORT.report({
        //     msg: "xx load error",                 // 错误信息
        //     target: "xxx.js",                     // 错误的来源js
        //     rowNum: 100,                          // 错误的行数
        //     colNum: 100,                          // 错误的列数
        // });
        report: function(msg, isReportNow) { // error report
            // 1
            // msg
            // msg = string | Error | config 可能是一个字符串，Error对象，配置对象
            // 2
            // isReportNow
            // isReportNow 是一个boolean值，表示是否立即上报
            msg && report.push(msg); // push

            isReportNow && _process_log(true);
            return report;
        },
        info: function(msg) { // info report
            if (!msg) {
                return report;
            }
            if (T.isOBJ(msg)) {
                msg.level = 2;
            } else {
                msg = {
                    msg: msg,
                    level: 2
                };
            }
            report.push(msg);
            return report;
        },
        debug: function(msg) { // debug report
            if (!msg) {
                return report;
            }
            if (T.isOBJ(msg)) {
                msg.level = 1;
            } else {
                msg = {
                    msg: msg,
                    level: 1
                };
            }
            report.push(msg);
            return report;
        },

        reportOfflineLog: function() {
            if (!window.indexedDB) {
                BJ_REPORT.info("unsupport offlineLog");
                return;
            }
            Offline_DB.ready(function(err, DB) {
                if (!DB) {
                    return;
                }
                var startDate = new Date - 0 - _config.offlineLogExp * 24 * 3600 * 1000;
                // startDate 开始时间
                // 1
                // new Data - 0 是把data对象转成现在距离1970/1/1/00:00:00的好描述
                // new Date - 0 = new Date() - 0 = Date.now() = data.constructor.now() = +new Date()
                var endDate = new Date - 0;
                DB.getLogs({ // 获取 startDate-endDate之间的数据
                    start: startDate,
                    end: endDate,
                    id: _config.id,
                    uin: _config.uin
                }, function(err, result) {
                    var iframe = document.createElement("iframe");
                    iframe.name = "badjs_offline_" + (new Date - 0);
                    iframe.frameborder = 0;
                    iframe.height = 0;
                    iframe.width = 0;
                    iframe.src = "javascript:false;";

                    iframe.onload = function() {
                        var form = document.createElement("form");
                        form.style.display = "none";
                        form.target = iframe.name;
                        form.method = "POST";
                        form.action = _config.offline_url || _config.url.replace(/badjs$/, "offlineLog");
                        form.enctype.method = 'multipart/form-data';

                        var input = document.createElement("input");
                        input.style.display = "none";
                        input.type = "hidden";
                        input.name = "offline_log";
                        input.value = JSON.stringify({ logs: result, userAgent: navigator.userAgent, startDate: startDate, endDate: endDate, id: _config.id, uin: _config.uin });

                        iframe.contentDocument.body.appendChild(form);
                        form.appendChild(input);
                        form.submit();

                        setTimeout(function() {
                            document.body.removeChild(iframe);
                        }, 10000);

                        iframe.onload = null;
                    };
                    document.body.appendChild(iframe);
                });
            });
        },
        offlineLog: function(msg) {
            if (!msg) {
                return report;
            }
            if (T.isOBJ(msg)) {
                msg.level = 20;
            } else {
                msg = {
                    msg: msg,
                    level: 20
                };
            }
            report.push(msg);
            return report;
        },
        // init
        init: function(config) { // 初始化
            if (T.isOBJ(config)) { // config是对象
                T.extend(_config, config); // _config 继承 config 对象上的属性，同名属性将被覆盖，返回 _config
                // BJ_REPORT.init({
                //     id: 1,                                // 上报 id, 不指定 id 将不上报
                //     uin: 123,                             // 指定用户 id, (默认已经读取 qq uin)
                //     delay: 1000,                          // 延迟多少毫秒，合并缓冲区中的上报（默认）
                //     url: "//badjs2.qq.com/badjs",         // 指定上报地址
                //     ignore: [/Script error/i],            // 忽略某个错误
                //     random: 1,                            // 抽样上报，1~0 之间数值，1为100%上报（默认 1）
                //     repeat: 5,                            // 重复上报次数(对于同一个错误超过多少次不上报)
                //                                           // 避免出现单个用户同一错误上报过多的情况
                //     onReport: function(id, errObj){},     // 当上报的时候回调。 id: 上报的 id, errObj: 错误的对象
                //     submit: null,                         // 覆盖原来的上报方式，可以自行修改为 post 上报等
                //     ext: {},                              // 扩展属性，后端做扩展处理属性。例如：存在 msid 就会分发到 monitor,
                //     offlineLog : false,                   // 是否启离线日志 [默认 false]
                //     offlineLogExp : 5,                    // 离线有效时间，默认最近5天
                //   });
            }
            // 没有设置id将不上报，id表示的是上报id
            var id = parseInt(_config.id, 10);
            // parseInt
            // - parseInt(string, radix) 解析一个字符串并返回指定基数的十进制整数
            // - parseInt(undefined, 10) // NaN
            // - Boolean(NaN) // false
            if (id) {
                // set default report url and uin
                if (/qq\.com$/gi.test(location.hostname)) {
                    // window.location.hostname = '...qq.com'
                    if (!_config.url) {
                        _config.url = "//badjs2.qq.com/badjs"; // url
                    }

                    if (!_config.uin) { // uni：用户id
                        _config.uin = parseInt((document.cookie.match(/\buin=\D+(\d+)/) || [])[1], 10);
                        // 1. \b 匹配单词边界
                        // 2. \D [^0-9] 匹配所有0-9以外的字符
                        // 3. \d [0-9]

                        // (document.cookie.match(/\buin=\D+(\d+)/) || [])[1]
                        // - 表示获取组(\d+)的匹配
                        // - const ww = 'xxx uin=xxx12345'
                        // - (ww.match(/\buin=\D+(\d+)/) || [])[1]
                        // - "12345"
                    }
                }

                // 1. 添加 _reportUrl 属性
                // 2. 组装 _reportUrl = url+?id=xxxx&uin=xxxx&
                _config._reportUrl = (_config.url || "/badjs") +
                    "?id=" + id +
                    "&uin=" + _config.uin +
                    // "&from=" + encodeURIComponent(location.href) +
                    "&";
            }

            // if had error in cache , report now
            // _log_list = [] 初始值，初始时不存在
            if (_log_list.length) {
                _process_log();
            }

            // init offline
            // 离线日志相关
            // badjs会将离线日志信息存储在indexDB数据库中，然后通过调用 reportOfflineLog() 上传离线日志
            if (!Offline_DB._initing) { // 初始化时，不存在
                Offline_DB._initing = true; // 立即改为true，表示已经初始化
                Offline_DB.ready(function(err, DB) { // Offline_DB.ready()的主要工作是打开数据库并设置success和upgradeneeded监听事件
                    if (DB) {
                        setTimeout(function() {
                            DB.clearDB(_config.offlineLogExp); // 清除过期日志，离线日志过期时间 ， 默认5天
                            setTimeout(function() {
                                _config.offlineLogAuto && _autoReportOffline();
                                // _config.offlineLogAuto 是否自动询问服务器需要自动上报
                            }, 5000);
                        }, 1000);
                    }

                });
            }



            return report;
            // init() 最终返回 report 对象
        },

        __onerror__: global.onerror
    };

    typeof console !== "undefined" && console.error && setTimeout(function() {
        var err = ((location.hash || "").match(/([#&])BJ_ERROR=([^&$]+)/) || [])[2];
        err && console.error("BJ_ERROR", decodeURIComponent(err).replace(/(:\d+:\d+)\s*/g, "$1\n"));
    }, 0);

    return report;

}(window));

if (typeof module !== "undefined") {
    module.exports = BJ_REPORT;
    // 1. 除了通过 IIFE 的方式(function(global){}(window)) 方式暴露
    // 2. 这里还兼容了 Node 环境
    // commonjs暴露接口的方式，即兼容commonjs，即兼容node环境
    // - 如果还要兼容amd和cmd可以用一个defined(BJ_REPORT)
}
