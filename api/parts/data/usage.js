var usage = {},
    common = require('./../../utils/common.js'),
    dbonoff = require('./../../utils/dbonoff.js'),
    geoip = require('geoip-lite'),
    time = require('time')(Date);
var process = require('process');

(function (usage) {

    var predefinedMetrics = [
        { db: "devices", metrics: [{ name: "_device", set: "devices"}] },
        { db: "carriers", metrics: [{ name: "_carrier", set: "carriers"}] },
        { db: "device_details", metrics: [{ name: "_os", set: "os"}, 
            { name: "_os_version", set: "os_versions"}, 
            { name: "_resolution", set: "resolutions" }] },
        { db: "app_versions", metrics: [{ name: "_app_version", set: "app_versions"}] }
    ];
    var OP_DECREASE=0;
    var OP_FILL=1;
    var OP_INCREASE=2;
    var dataBag = {};
    dataBag.apps = [];
    dataBag.updateSessions = {};
    dataBag.updateLocations = {};
    dataBag.updateUsers = {};
    dataBag.updateCities = {};
    dataBag.userRanges = {};
    dataBag.sessionRanges = {};
    dataBag.countryArray = {};
    dataBag.cityArray = {};
    dataBag.updateMetrics = {};
    dataBag.MetricMetaSet = {};
    dataBag.userRanges['meta.f-ranges'] = {};
    dataBag.userRanges['meta.l-ranges'] = {};
    dataBag.sessionRanges['meta.d-ranges'] = {};
    dataBag.userRanges['meta.f-ranges']['$each'] = [];
    dataBag.userRanges['meta.l-ranges']['$each'] = [];
    dataBag.sessionRanges['meta.d-ranges']['$each'] = [];
    dataBag.countryArray['meta.countries'] = {};
    dataBag.cityArray['meta.cities'] = {};
    dataBag.countryArray['meta.countries']['$each'] = [];
    dataBag.cityArray['meta.cities']['$each'] = [];

    //query user data and execute processUserSession
    usage.processSession = function (app, isFinal, appinfo) {
        //console.log(app[0].device_id);
        var appinfos = {};
        //if (appinfo) console.log(appinfo);
        if (appinfo) {
            appinfos.app_id = appinfo._id;
            appinfos.appTimezone = appinfo.timezone;
            appinfos.app_cc = appinfo.country;
        } else {
            appinfos.app_id = app[0].app_id;
            appinfos.appTimezone = app[0].appTimezone;
            appinfos.app_cc = app[0].app_cc;

        }
        
        var uma = appinfos.app_id;

        common.db.collection('uma').update({'_id':app[0].device_id}, {'$addToSet': {'my_apps': uma}}, {'upsert': true}
            , function (err, data) {
                if (err){
                    console.log('[processSession]uma log error:' + err);  
                }
                dbonoff.on('raw');
        });

       	common.db.collection('app_users' + appinfos.app_id).findOne({'_id': app[0].app_user_id}, 
       	    function (err, dbAppUser){
                dataBag.apps = app;
                var final = isFinal;
                var info = appinfos;
                //console.log('process Session');

               	processUserSession(dataBag, dbAppUser, isFinal, info);
       	});
    }


    function dbCallback(err, object) {
       	if (err){
            console.log(errHeader+':'+err);  
       	}
        dbonoff.on('raw');
    }

    function durationRange(totalSessionDuration) {
        var durationRanges = [
            [0,10],
            [11,30],
            [31,60],
            [61,180],
            [181,600],
            [601,1800],
            [1801,3600]
        ];
        var durationMax = 3601;
        var calculatedDurationRange='';

        if (totalSessionDuration >= durationMax) {
            calculatedDurationRange = (durationRanges.length) + '';
            //calculatedDurationRange = durationRanges.length;
        } else {
            for (var i=0; i < durationRanges.length; i++) {
                if (totalSessionDuration <= durationRanges[i][1] && totalSessionDuration >= durationRanges[i][0]) {
                    calculatedDurationRange = i + '';
                    //calculatedDurationRange = i;
                    break;
                }
            }
        }

        return calculatedDurationRange;
    }

    function updateSessionDuration(dataBag, sessionObj, toFill) {
        var session_duration = sessionObj.acc_duration;
        var updateTimeObject = getTimeFunction(toFill);
        var thisDurationRange = durationRange(session_duration);
        updateTimeObject(sessionObj, dataBag.updateSessions, common.dbMap['durations'] + '.' + thisDurationRange);
        if (common.config.api.session_duration_limit && session_duration > common.config.api.session_duration_limit) {
                session_duration = common.config.api.session_duration_limit;
        }
        updateTimeObject(sessionObj, dataBag.updateSessions, common.dbMap['duration'], session_duration);
    	if (toFill != OP_DECREASE) {
            //common.arrayAddUniq(dataBag.sessionRanges['meta.d-ranges']['$each'],parseInt(thisDurationRange));
            common.arrayAddUniq(dataBag.sessionRanges['meta.d-ranges']['$each'], thisDurationRange);
    	}
    }


    function computeFreqRange(userTime, userLastSeenTimestamp) {
        var sessionFrequency = [
            [0,1],
            [1,24],
            [24,48],
            [48,72],
            [72,96],
            [96,120],
            [120,144],
            [144,168],
            [168,192],
            [192,360],
            [360,744]
        ],
        sessionFrequencyMax = 744;

        if ((userTime - userLastSeenTimestamp) >= (sessionFrequencyMax * 60 * 60)) {
            return sessionFrequency.length + '';
        } else {
            for (var i=0; i < sessionFrequency.length; i++) {
                if ((userTime - userLastSeenTimestamp) < (sessionFrequency[i][1] * 60 * 60) &&
                    (userTime - userLastSeenTimestamp) >= (sessionFrequency[i][0] * 60 * 60)) {
                    return i + '';
                }
            }
        }
        return '';
    }

    function computeLoyaltyRange(userSessionCount) {
        var loyaltyRanges = [
            [0,1],
            [2,2],
            [3,5],
            [6,9],
            [10,19],
            [20,49],
            [50,99],
            [100,499]
        ],
        loyaltyMax = 500;

        if (userSessionCount >= loyaltyMax) {
            return loyaltyRanges.length + '';
        } else {
            for (var i = 0; i < loyaltyRanges.length; i++) {
                if (userSessionCount <= loyaltyRanges[i][1] && userSessionCount >= loyaltyRanges[i][0]) {
                    return i + '';
                }
            }
        }
        return '';
    }


    function updateRangeMeta(ranges, coll, id) {
        common.db.collection(coll).update({'_id': id}, {'$addToSet': ranges}, {'upsert': true}, dbCallback); 
    }

    function updateCollection(collName, id, data, op, errHeader) {
    	var opSet = {};
    	opSet[op] = data;
        common.db.collection(collName).update({'_id': id}, opSet, {'upsert': true}, dbCallback); 
    }

    function reallyUpdateAll(dataBag, appinfos) {
        console.log("isFinal:"+appinfos.app_id);
        updateRangeMeta(dataBag.userRanges, 'users', appinfos.app_id);
        updateCollection('users', appinfos.app_id, dataBag.updateUsers, '$inc', '[updateUsers]');

        updateRangeMeta(dataBag.countryArray, 'locations', appinfos.app_id);
        updateCollection('locations', appinfos.app_id, dataBag.updateLocations, '$inc', '[updateLocations]');
 
        updateRangeMeta(dataBag.sessionRanges, 'sessions', appinfos.app_id);
        updateCollection('sessions', appinfos.app_id, dataBag.updateSessions, '$inc', '[updateSessions]');

        if (common.config.api.city_data !== false) {
            updateRangeMeta(dataBag.cityArray, 'cities', appinfos.app_id);
            updateCollection('cities', appinfos.app_id, dataBag.updateCities, '$inc', '[updateCities]');
        }


        for (var i=0; i < predefinedMetrics.length; i++) {
            //console.log(dataBag.MetricMetaSet[predefinedMetrics[i].db]);
            updateRangeMeta(dataBag.MetricMetaSet[predefinedMetrics[i].db], predefinedMetrics[i].db, appinfos.app_id);
            updateCollection(predefinedMetrics[i].db, appinfos.app_id, dataBag.updateMetrics[predefinedMetrics[i].db], '$inc', '[updateMetrics:'+predefinedMetrics[i].db+']');
        }
        process.emit('hi_mongo');
        console.log('send out hi mongo');
        dataBag.apps = [];
        dataBag.updateSessions = {};
        dataBag.updateLocations = {};
        dataBag.updateUsers = {};
        dataBag.updateCities = {};
        dataBag.userRanges = {};
        dataBag.sessionRanges = {};
        dataBag.countryArray = {};
        dataBag.cityArray = {};
        dataBag.updateMetrics = {};
        dataBag.MetricMetaSet = {};
        dataBag.userRanges['meta.f-ranges'] = {};
        dataBag.userRanges['meta.l-ranges'] = {};
        dataBag.sessionRanges['meta.d-ranges'] = {};
        dataBag.userRanges['meta.f-ranges']['$each'] = [];
        dataBag.userRanges['meta.l-ranges']['$each'] = [];
        dataBag.sessionRanges['meta.d-ranges']['$each'] = [];
        dataBag.countryArray['meta.countries'] = {};
        dataBag.cityArray['meta.cities'] = {};
        dataBag.countryArray['meta.countries']['$each'] = [];
        dataBag.cityArray['meta.cities']['$each'] = [];
    }

    function updateFreqRange(dataBag, sessionObj, dbAppUser) {
        // Calculate the frequency range of the user
	//console.log('updateFreqRange:%j', sessionObj);
	//console.log(dbAppUser);
        var calculatedFrequency;
    	if (!dbAppUser || !dbAppUser.timestamp) { //new user
                return;
    	} else {
                calculatedFrequency = computeFreqRange(sessionObj.timestamp, dbAppUser.timestamp);
    	}
        if (calculatedFrequency != '') {
            common.fillTimeObject(sessionObj, dataBag.updateUsers, common.dbMap['frequency'] + '.' + calculatedFrequency);
            common.arrayAddUniq(dataBag.userRanges['meta.f-ranges']['$each'],calculatedFrequency);
        }
    } 

    function updateLoyaltyRange(dataBag, sessionObj, session_count) {
        // Calculate the loyalty range of the user
        var calculatedLoyaltyRange = computeLoyaltyRange(session_count);
        common.fillTimeObject(sessionObj, dataBag.updateUsers, common.dbMap['loyalty'] + '.' + calculatedLoyaltyRange);
	common.arrayAddUniq(dataBag.userRanges['meta.l-ranges']['$each'], calculatedLoyaltyRange);
    } 
   
    function getTimeFunction(toFill) {
        var updateTimeObject;
        switch (toFill) {
            case OP_INCREASE:
                updateTimeObject = common.incrTimeObject;
                break;
            case OP_DECREASE:
                updateTimeObject = common.decrTimeObject;
                break;
            default:
                updateTimeObject = common.fillTimeObject;
        }
        return updateTimeObject;
    }

    function updateMetricTimeObj(dataBag, sessionObject, prop, toFill, sessions) {
        if (!sessionObject.metrics) return; 

        var updateTimeObject = getTimeFunction(toFill);
        for (var i=0; i<predefinedMetrics.length; i++) {
            var metricDb = predefinedMetrics[i].db;
            for (var j=0; j<predefinedMetrics[i].metrics.length; j++) {
                var tmpMetric = predefinedMetrics[i].metrics[j];
                var recvMetricValue = sessionObject.metrics[tmpMetric.name];

                if (recvMetricValue) {
                    var escapedMetricVal = recvMetricValue.replace(/^\$/, "").replace(/\./g, ":");
                    var metricMeta = 'meta.' + tmpMetric.set;
        		    if (!dataBag.MetricMetaSet[metricDb]) {
                        dataBag.MetricMetaSet[metricDb] = {};
        		    }
        		    if (!dataBag.MetricMetaSet[metricDb][metricMeta]) {
                        dataBag.MetricMetaSet[metricDb][metricMeta] = {};
        		    }
        		    if (!dataBag.MetricMetaSet[metricDb][metricMeta]['$each'] || 
            			!dataBag.MetricMetaSet[metricDb][metricMeta]['$each'].length) {
            			dataBag.MetricMetaSet[metricDb][metricMeta]['$each'] = [];
        		    }
                    common.arrayAddUniq(dataBag.MetricMetaSet[metricDb][metricMeta]['$each'], escapedMetricVal);

        		    if (!sessions.updateMetrics[metricDb]) {
        			     sessions.updateMetrics[metricDb] = {};
                    }	
                    updateTimeObject(sessionObject, sessions.updateMetrics[metricDb], escapedMetricVal + '.' + prop);
                }
            }
        }
    }

    function updateStatistics(dataBag, sessionObject, prop, toFill, increase, tmp_session) {
        var incr = increase? increase : 1;
        var updateTimeObject = getTimeFunction(toFill);
        var sessions;
    	if (!tmp_session) {
            sessions = dataBag;
    	} else {
    	    sessions = tmp_session;
    	}
        updateTimeObject(sessionObject, sessions.updateSessions, prop, incr);
        updateTimeObject(sessionObject, sessions.updateLocations, sessionObject.country + '.' + prop, incr);
        common.arrayAddUniq(dataBag.countryArray['meta.countries']['$each'], sessionObject.country);
        if (common.config.api.city_data !== false) {
            updateTimeObject(sessionObject, sessions.updateCities, sessionObject.city + '.' + prop, incr);
            common.arrayAddUniq(dataBag.cityArray['meta.cities']['$each'], sessionObject.city);
        }
        updateMetricTimeObj(dataBag, sessionObject, prop, toFill, sessions);
    }

    function updateUserProfile(dataBag, sessionObject, finalUserObject, appinfos) {
        var userProps = {};
        userProps[common.dbUserMap['device_id']] = sessionObject.device_id;
        userProps[common.dbUserMap['session_duration']] = parseInt(sessionObject.acc_duration);
        userProps[common.dbUserMap['total_session_duration']] = parseInt(finalUserObject[common.dbUserMap['total_session_duration']]);
        userProps[common.dbUserMap['session_count']] = finalUserObject[common.dbUserMap['session_count']];
        userProps[common.dbUserMap['last_end_session_timestamp']] = finalUserObject[common.dbUserMap['last_end_session_timestamp']];
        userProps.metrics = sessionObject.metrics;
        userProps.appTimezone = appinfos.appTimezone;
        userProps.app_cc = appinfos.app_cc;
        userProps.timestamp = sessionObject.timestamp;
        userProps.tz = sessionObject.tz;
        //userProps.time = sessionObject.time;
        userProps.country = sessionObject.country;
        userProps.city = sessionObject.city;
        userProps.app_id = appinfos.app_id;
        userProps.app_user_id = sessionObject.app_user_id;
        userProps.ip_address = sessionObject.ip_address;
        updateCollection('app_users'+appinfos.app_id, sessionObject.app_user_id, userProps, '$set', '[userProps]'); 
    }

    function cpUniqueOneByOne(x, y) {
        for (var times in x) {
            //console.log(times+":"+y[times]);
            if (y[times]) {
                y[times] += x[times];
            } else {
                y[times] = x[times];
            }
        }   
    }

    function cpUniqueSession(dataBag, uniqueSession) {
        cpUniqueOneByOne(uniqueSession.updateSessions, dataBag.updateSessions);
        cpUniqueOneByOne(uniqueSession.updateLocations, dataBag.updateLocations);
        cpUniqueOneByOne(uniqueSession.updateCities, dataBag.updateCities);
        for (var i=0; i < predefinedMetrics.length; i++) {
            var metricDb = predefinedMetrics[i].db;
            for (var j=0; j<predefinedMetrics[i].metrics.length; j++) {
                cpUniqueOneByOne(uniqueSession.updateMetrics[metricDb], dataBag.updateMetrics[predefinedMetrics[i].db]);
            }
        }
        //console.log(uniqueSession.updateSessions);
        //console.log(dataBag.updateSessions);
    }

    function processUserSession(dataBag, dbAppUser, isFinal, appinfos) {
        var apps = dataBag.apps;
        var sessionObj = [];
        var last_end_session_timestamp = 0;
        var total_duration = 0;
	var i = 0;
	var normalSessionStart = 0;
    //console.log(dataBag.apps);

	//console.log('process user session length='+dataBag.apps.length);
	//if (dbAppUser) console.log(dbAppUser);
	//else console.log(apps[0]);
        if (dbAppUser) { //set sessionObj[0] = dbAppUser to compute on-going session
	    //console.log('dbAppUser=%j', dbAppUser);
            dbAppUser.acc_duration = parseInt(dbAppUser[common.dbUserMap['session_duration']]);
            dbAppUser.time = common.initTimeObj(dbAppUser.appTimezone, dbAppUser.timestamp, dbAppUser.tz);
            sessionObj[0] = common.clone(dbAppUser);
            last_end_session_timestamp = dbAppUser[common.dbUserMap['last_end_session_timestamp']];
        } else { //new user
            sessionObj[0] = {};
    	    for (;normalSessionStart<apps.length; normalSessionStart++) {
                if (apps[normalSessionStart].begin_session) break;
    	    }
        }
    	if (normalSessionStart >= apps.length) { //no begin_session for new user -->for the remaining logs from previous data
    	    //console.log('Incomplete session data from past users');
    	    return;
    	}
        /* for boundary condition:
            1. dbAppUser contains begin_session(last_end_session_timestamp=0): 
                end_session will update last_end_session_timestamp, 
                session duration will increase total durations; ongoing begin_session will just continue; 
                new begin_session will init new sessionObj
            2. dbAppUser contains end_session: ongoing begin_session will just continue; 
                new begin_session will init new sessionObj
            3. the last one is begin_session: last_end_session_timestamp = 0; acc_duration = current session_duration
            4. the last one is end_session: last_end_session_timestamp = current timestamp;
                acc_duration = current session_duration
        */
        var currObjIdx = 0;
        //console.log('normal start='+normalSessionStart+'; length='+apps.length);
        for (i=normalSessionStart; i<apps.length; i++) {
    	    if (!apps[i].timestamp) {
        		console.log('no timestamp');
        		continue;
            }
            apps[i].time = common.initTimeObj(appinfos.appTimezone, apps[i].timestamp, apps[i].tz);

            //set event(request) count for every request
            common.incrTimeObject(apps[i], dataBag.updateSessions, common.dbMap['events']); 
            if (apps[i].begin_session) {
                common.computeGeoInfo(apps[i]);
                //console.log('dataBag app:'+i+':begin_session');
                if ((apps[i].timestamp - last_end_session_timestamp) < common.config.api.cl_endsession_ongoing_timeout) { //ongoing session
                    last_end_session_timestamp = 0;
                    continue;
                }
                last_end_session_timestamp = 0;
                //init a new sessionObj to keep the session with this begin_session
                sessionObj[++currObjIdx] = apps[i];
                sessionObj[currObjIdx].acc_duration = 0;
            }
            if (apps[i].end_session) { 
                //used to judge if there will be ongoing session
                last_end_session_timestamp = apps[i].timestamp;
            }
            if (apps[i].session_duration) {
                sessionObj[currObjIdx].acc_duration += parseInt(apps[i].session_duration);
                total_duration += parseInt(apps[i].session_duration);
            }
        }

        //console.log('sessionObj:'+currObjIdx);
        //Prepare final Session info to update
        var finalUserObject = {};
        finalUserObject[common.dbUserMap['last_end_session_timestamp']] = last_end_session_timestamp;
        finalUserObject[common.dbUserMap['session_count']] = (dbAppUser?dbAppUser[common.dbUserMap['session_count']]:0) + currObjIdx;
        finalUserObject[common.dbUserMap['total_session_duration']] 
            = total_duration + (dbAppUser?parseInt(dbAppUser[common.dbUserMap['total_session_duration']]):0);

        var sessionObjByDay = [];
        var sessionDay = null;
        var sessionDayIdx = -1;
        var startIdx = dbAppUser? 0 : 1;
        var calculatedDurationRange = 0;
        var uniqueSession={};
        uniqueSession.updateSessions = {};
        uniqueSession.updateLocations = {};
        uniqueSession.updateCities = {};
        uniqueSession.updateMetrics = {};

        for (i=startIdx; i<=currObjIdx; i++) { 
            if (sessionDay != sessionObj[i].time.daily) { //sort sessions by day
                sessionDay = sessionObj[i].time.daily;
                sessionObjByDay[++sessionDayIdx]= [];                
            }
            sessionObjByDay[sessionDayIdx].push(sessionObj[i]);

            if (sessionObj[i].acc_duration > 0) { //ignore partial session which has no end_session or session_duration info
                updateSessionDuration(dataBag, sessionObj[i], OP_INCREASE);
            }

            //set total user/unique user count in necessary collections   
            updateStatistics(dataBag, sessionObj[i], common.dbMap['total'], OP_INCREASE); //will increase for every session
            updateStatistics(dataBag, sessionObj[i], common.dbMap['unique'], OP_FILL, 1, uniqueSession); // only set once
            //console.log(uniqueSession.updateSessions);
        }
	    //console.log('sessionObjByDay='+(i-startIdx+1));
//	    console.log(sessionObjByDay);
        cpUniqueSession(dataBag, uniqueSession);
        //For frequency computation, no need to do with sessions in the same day as old sessions(dbAppUser)
        //The 1st session will be dealt with in new user block
        for (i=1; i<sessionObjByDay.length; i++) { 
            updateFreqRange(dataBag, sessionObjByDay[i][0], sessionObjByDay[i-1][sessionObjByDay[i-1].length-1]);
        }

        //update loyalty from the 2nd day
        var session_count = dbAppUser?dbAppUser[common.dbUserMap['session_count']]:0;
        for (i=1; i<sessionObjByDay.length; i++) {
            session_count += sessionObjByDay[i-1].length;
            updateLoyaltyRange(dataBag, sessionObjByDay[i][0], session_count);
        }

        //If there is on-going session coming in at first...
        if (dbAppUser) {
            //Update last session in DB to include new session duration sent after last processing, also update duration ranges
            if (dbAppUser.acc_duration>0) {
                updateSessionDuration(dataBag, dbAppUser, OP_DECREASE);
            }
            updateStatistics(dataBag, dbAppUser, common.dbMap['total'], OP_DECREASE); 
            updateStatistics(dataBag, dbAppUser, common.dbMap['unique'], OP_DECREASE); // reset previous add in sessionObj

        } else { //set new user count in necessary collections   
            updateStatistics(dataBag, sessionObjByDay[0][0], common.dbMap['new'], OP_INCREASE);
            updateLoyaltyRange(dataBag, sessionObjByDay[0][0], 1); //session count = 1
            updateFreqRange(dataBag, sessionObjByDay[0][0], sessionObjByDay[0][0]); //set 1st session
        }

        //use last session object to update user profiles (metrics)
        updateUserProfile(dataBag, sessionObj[currObjIdx], finalUserObject, appinfos);

        //do the real update job in MongoDB
    	if (isFinal) {
	       reallyUpdateAll(dataBag, appinfos);
    	}
    }
}(usage));

module.exports = usage;
