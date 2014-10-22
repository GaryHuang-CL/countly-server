var http = require('http'),
    cluster = require('cluster'),
    os = require('os'),
    url = require('url'),
    common = require('./utils/common.js'),
    dbonoff = require('./utils/dbonoff.js'),
    debug = require('./utils/cl/debug.js'),
    ObjectID = require('mongodb').ObjectID,
    countlyApi = {
        data:{
            usage:require('./parts/data/usage.js'),
            fetch:require('./parts/data/fetch.js'),
            events:require('./parts/data/events.js')
        },
        mgmt:{
            users:require('./parts/mgmt/users.js'),
        }
    };
var fs = require('fs');
/*var sync = require('synchronize');
var fiber = sync.fiber;
var await = sync.await;
var defer = sync.defers;*/
var eFin = false;
var sFin = false;

http.globalAgent.maxSockets = common.config.api.max_sockets || 1024;

var date = new Date();
var begin_date = new Date(date.getFullYear(),date.getMonth(), date.getDate()-30);
var end_date = new Date(date.getFullYear(),date.getMonth(), date.getDate()+1);
//console.log('proc_date = '+begin_date+':'+end_date);
var bdd = Math.floor(begin_date.getTime()/1000);
var edd = Math.floor(end_date.getTime()/1000);
var bid = new ObjectID(bdd.toString(16)+'0000000000000000');
//var bid = new ObjectID('542a50d9981a3d812e000006');
var eid = new ObjectID(edd.toString(16)+'0000000000000000');
//var eid = new ObjectID('542a50e0981a3d812e000007');
var log_id = '000000000000000000000000';

console.log("raw:"+common.db_raw._dbconn.databaseName);
console.log("batch:"+common.db_batch._dbconn.databaseName);

var isDebug = common.config.api.cl_is_debug;
var oidFileName = '_next_oid';
var hasOidFile = false;
var user_cnt = 0;

/*function processEvents(app, isFinal, appinfo) {
    process.nextTick(countlyApi.data.events.processEvents(app, isFinal, appinfo));
}

function processSessions(app, isFinal, appinfo) {
    console.log('entering sessions');
    var processFun = countlyApi.data.usage.processSession;
    process.nextTick(countlyApi.data.usage.processSession(app, isFinal, appinfo));
}
*/

// This function returns a future which resolves after a timeout. This
// demonstrates manually resolving futures.


var processSingleRaw = function(apps, res, curr_app_user, processData, appinfo) {
    if (res.app_user_id != curr_app_user) {
        //console.log('loglist='+apps.length);
        processData(apps, false, appinfo);
        curr_app_user = res.app_user_id;
        apps = [];
        user_cnt++;
    }
    
    apps[apps.length] = res;
    return curr_app_user;
};

var processRaw = function(collectionName, processData, sortOrder, appinfo) {
    //debug.writeLog('/usr/local/countly/log/batch.log', collectionName+":bid = "+bid+" eid = "+eid+" date:"+date.toString());
    console.log('[Entering processRaw] '+collectionName+":bid = "+bid+" eid = "+eid);
    var curr_app_user = null;
    var isFirst = true;
    var apps = [];
    //var appinfos = appinfo;
    var b_coll = common.db_batch.collection(collectionName);
    b_coll.find({_id:{$lt:eid, $gte:bid}},{batchSize:1000}).sort(sortOrder).each(function(err, res) {
        if (res) {
            if (isFirst) {
                curr_app_user = res.app_user_id;
                isFirst = false;
            } else {
                if (res.app_user_id != curr_app_user) {
                    //console.log('loglist='+apps.length);
                    processData(apps, false, appinfo);
                    curr_app_user = res.app_user_id;
                    apps = [];
        //user_cnt++;
                }
            }
            apps[apps.length] = res;
    
/*            curr_app_user = processSingleRaw(apps, res, curr_app_user, processData, appinfo);  
            if (user_cnt >= common.config.api.cl_process_user_cnt) {
                sleep(common.config.api.cl_wait_for_process).wait();
                console.log('user_cnt='+user_cnt);
                user_cnt = 0;
            }          
*/
        } else {
            if (isFirst) { //no data
                console.log('No data');
                return false;
            }
            var cnt = apps.length - 1;
            console.log('loglist='+cnt);
            processData(apps, true, appinfo);
            //user_cnt++;

            //_next_oid logging
            if (isDebug || (hasOidFile && apps[cnt]._id > log_id)) {
                log_id = apps[cnt]._id;
                fs.writeFile(oidFileName, log_id, function(err){});
            }
            return true;
        }
    });
}

/*
        Fiber( function () {
            try {
                 //console.log(res);
                if (!res) { //end of collection
                    if (isFirst) { //no data
                        console.log('No data');
                        return false;
                    }
                    var cnt = apps.length - 1;
                    console.log('loglist='+cnt);
                    processData(apps, true, appinfos);

                    //_next_oid logging
                    if (isDebug || (hasOidFile && apps[cnt]._id > log_id)) {
                        log_id = apps[cnt]._id;
                        fs.writeFile(oidFileName, log_id, function(err){});
                    }
                    return true;
                }

                if (isFirst) {
                    curr_app_user = res.app_user_id;
                    isFirst = false;
                } else {
                    if (res.app_user_id != curr_app_user) {
                        console.log('loglist='+apps.length);
                        sleep(user_cnt);
                        processData(apps, false, appinfos);
                        curr_app_user = res.app_user_id;
                        apps = [];
                        user_cnt++;
                    }
                    if (user_cnt >= common.config.api.cl_process_user_cnt) {
                        sleep(common.config.api.cl_wait_for_process).wait();
                        user_cnt = 0;
                    }
                }
                apps[apps.length] = res;
                console.log('user_cnt='+user_cnt);

            } catch (e) {
                console.log('[ProcessRaw]'+e);
            }
        }).run();
    });
    */

function dbClose() {
    common.db.close();
    common.db_batch.close();
    common.db_ibb.close();
}

var app_key;
if (process.argv.length < 3) {
    if (isDebug) {
        console.log('no app key parameter');
        debug.writeLog('/usr/local/countly/log/batch.log', "no app id parameter");
        process.exit(1);
    } else { //batch processing all
        app_key = 'all';
    }
} else { //process only one APP
    app_key = process.argv[2];
}

process.setMaxListeners(0);
if (isDebug) {
    oidFileName = oidFileName + process.argv[2];
}

var Future = require('fibers/future');
var fs = Future.wrap(require('fs'));

fs.readFile(oidFileName, 'utf8', function(err, data) {
    if (data && data.length>=24) {
    	hasOidFile = true;
    	console.log('data:'+data+':'+data.length);
    	bid = new ObjectID(data.substr(0,24));
    	if (data.length >= 48) {
    	    eid = new ObjectID(data.substr(25,24));
    	}
    }

    var wait_cnt = common.config.api.cl_wait_time;
    if (app_key == 'all') {
     	wait_cnt = wait_cnt * 5; // wait 5 times for all logs
        common.db_batch.collections(function(err, collection) {
            if (!collection.length) {
                console.log('no data');
                dbClose();
                process.exit(1);
            }
            for (var i=0; i<collection.length; i++) {
                console.log(collection[i].collectionName);
            }
            for (var i=0; i<collection.length; i++) {
                var collectionName = collection[i].collectionName;
                var sortOrder;
                var processData;
                var keys;
                console.log(collectionName);
                //exclude IPSentry
                if (collectionName == 'raw_session_53f554ef847577512100130a') continue;
                if (collectionName.indexOf(common.rawCollection['event'])>=0) {
                    keys = collectionName.substr(common.rawCollection['event'].length).trim();
                    sortOrder = {app_user_id:1};
                    processData = countlyApi.data.events.processEvents;
                } else if (collectionName.indexOf(common.rawCollection['session'])>=0) {
                    keys = collectionName.substr(common.rawCollection['session'].length).trim();
                    sortOrder = {app_user_id:1, timestamp:1};
                    processData = countlyApi.data.usage.processSession;
                } else continue;
                    console.log('begin of findone key:'+keys);
                    common.db.collection('apps').findOne({key:keys}, function(err, res) {
                        if (err) {
                            console.log(err);
                        } 
                        processRaw(collectionName, processData, sortOrder, res);
                    });
            }
        });  
    } else {
        common.db.collection('apps').findOne({key:app_key}, function(err, res) {
            if (err) {
                console.log(err);
            } 
            processRaw(common.rawCollection['session']+app_key, countlyApi.data.usage.processSession, {app_user_id:1, timestamp:1}, res);
            processRaw(common.rawCollection['event']+app_key, countlyApi.data.events.processEvents,{app_user_id:1}, res);
        });
    }
});


