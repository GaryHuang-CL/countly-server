var events = {},
    common = require('./../../utils/common.js');

(function (events) {
    var eventCollections = {};
    var eventSegments = {};
    var eventArray = [];            

    events.processEvents = function(params) {
        var cur_idx = 0;
        var app_id = app[0].app_id;
        var updateSessions = {};

        for (i=0; i<app.length; i++) {
            app[i].time = common.initTimeObj(params.appTimezone, params.timestamp, params.tz);
            //update requests count
            common.incrTimeObject(params, updateSessions, common.dbMap['events']); 

            if (app[i].app_user_id != curr_app_user) { //save last session data, initialize a new one
                logCurrUserEvents(app.slice(cur_idx, i));
                cur_idx = i;
                curr_app_user = app[i].app_user_id;
            }
            eventAddup(app[i]);
        }
        logCurrUserEvents(app.slice(cur_idx));
        updateEvents();

        common.db.collection('sessions').update({'_id':app_id}, {'$inc':updateSessions},  
            {'upsert': true}, function(err, object) {
                if (err){
                    console.log('[updateSessions]:'+err);  
                }
            });
        );
    }

    function eventAddup(params) {
        var tmpEventObj = {},
            tmpEventColl = {},
            shortCollectionName = "",
            eventCollectionName = "";

        for (i=0; i < params.events.length; i++) {

            var currEvent = params.events[i];
            tmpEventObj = {};
            tmpEventColl = {};
            
            console.log('current event:%j', currEvent);

            // Key and count fields are required
            if (!currEvent.key || !currEvent.count || !common.isNumber(currEvent.count)) {
                console.log('No key or count:%j', currEvent);
                continue;
            }

            // Mongodb collection names can not contain system. or $
            shortCollectionName = currEvent.key.replace(/system\.|\.\.|\$/g, "");
            eventCollectionName = shortCollectionName + params.app_id;

            // Mongodb collection names can not be longer than 128 characters
            if (eventCollectionName.length > 128) {
                console.log('[Error]:Event name too long!');
                continue;
            }

            // If present use timestamp inside each event while recording
            if (params.events[i].timestamp) {
                params.time = common.initTimeObj(params.appTimezone, params.events[i].timestamp, params.events[i].tz);
            }

            common.arrayAddUniq(eventArray, shortCollectionName);

            if (currEvent.sum && common.isNumber(currEvent.sum)) {
                common.fillTimeObject(params, tmpEventObj, common.dbMap['sum'], currEvent.sum);
            }
            common.fillTimeObject(params, tmpEventObj, common.dbMap['count'], currEvent.count);

            tmpEventColl["no-segment"] = tmpEventObj;

            if (currEvent.segmentation) {
                for (var segKey in currEvent.segmentation) {

                    if (!currEvent.segmentation[segKey]) {
                        continue;
                    }

                    tmpEventObj = {};
                    var tmpSegVal = currEvent.segmentation[segKey] + "";

                    // Mongodb field names can't start with $ or contain .
                    tmpSegVal = tmpSegVal.replace(/^\$/, "").replace(/\./g, ":");

                    if (currEvent.sum && common.isNumber(currEvent.sum)) {
                        common.fillTimeObject(params, tmpEventObj, tmpSegVal + '.' + common.dbMap['sum'], currEvent.sum);
                    }
                    common.fillTimeObject(params, tmpEventObj, tmpSegVal + '.' + common.dbMap['count'], currEvent.count);

                    if (!eventSegments[eventCollectionName]) {
                        eventSegments[eventCollectionName] = {};
                    }

                    if (!eventSegments[eventCollectionName]['meta.' + segKey]) {
                        eventSegments[eventCollectionName]['meta.' + segKey] = {};
                    }

                    common.arrayAddUniq(eventSegments[eventCollectionName]['meta.' + segKey]["$each"], tmpSegVal);

                    if (!eventSegments[eventCollectionName]["meta.segments"]) {
                        eventSegments[eventCollectionName]["meta.segments"] = {};
                        eventSegments[eventCollectionName]["meta.segments"]["$each"] = [];
                    }

                    common.arrayAddUniq(eventSegments[eventCollectionName]["meta.segments"]["$each"], segKey);
                    tmpEventColl[segKey] = tmpEventObj;
                }
            } else if (currEvent.seg_val && currEvent.seg_key) {
                tmpEventObj = {};

                // Mongodb field names can't start with $ or contain .
                currEvent.seg_val = currEvent.seg_val.replace(/^\$/, "").replace(/\./g, ":");

                if (currEvent.sum && common.isNumber(currEvent.sum)) {
                    common.fillTimeObject(params, tmpEventObj, currEvent.seg_val + '.' + common.dbMap['sum'], currEvent.sum);
                }
                common.fillTimeObject(params, tmpEventObj, currEvent.seg_val + '.' + common.dbMap['count'], currEvent.count);

                if (!eventSegments[eventCollectionName]) {
                    eventSegments[eventCollectionName] = {};
                }

                if (!eventSegments[eventCollectionName]['meta.' + currEvent.seg_key]) {
                    eventSegments[eventCollectionName]['meta.' + currEvent.seg_key] = {};
                }

                common.arrayAddUniq(eventSegments[eventCollectionName]['meta.' + currEvent.seg_key]["$each"], currEvent.seg_val);

                if (!eventSegments[eventCollectionName]["meta.segments"]) {
                    eventSegments[eventCollectionName]["meta.segments"] = {};
                    eventSegments[eventCollectionName]["meta.segments"]["$each"] = [];
                }

                common.arrayAddUniq(eventSegments[eventCollectionName]["meta.segments"]["$each"], currEvent.seg_key);
                tmpEventColl[currEvent.seg_key] = tmpEventObj;
            }

            if (!eventCollections[eventCollectionName]) {
                eventCollections[eventCollectionName] = {};
            }

            mergeEvents(eventCollections[eventCollectionName], tmpEventColl);
            return eventCollections;
        }

        function mergeEvents(firstObj, secondObj) {
            for (var firstLevel in secondObj) {

                if (!secondObj.hasOwnProperty(firstLevel)) {
                    continue;
                }

                if (!firstObj[firstLevel]) {
                    firstObj[firstLevel] = secondObj[firstLevel];
                    continue;
                }

                for (var secondLevel in secondObj[firstLevel]) {

                    if (!secondObj[firstLevel].hasOwnProperty(secondLevel)) {
                        continue;
                    }

                    if (firstObj[firstLevel][secondLevel]) {
                        firstObj[firstLevel][secondLevel] += secondObj[firstLevel][secondLevel];
                    } else {
                        firstObj[firstLevel][secondLevel] = secondObj[firstLevel][secondLevel];
                    }
                }
            }
        }
    }

    function updateEvents = function() {
        // update Segmentation_key+App_id collections
        for (var collection in eventCollections) {
            for (var segment in eventCollections[collection]) {
                if (segment == "no-segment" && eventSegments[collection]) {
                    common.db.collection(collection).update({'_id': segment}, {'$inc': eventCollections[collection][segment], '$addToSet': eventSegments[collection]}, {'upsert': true});
                } else {
                    common.db.collection(collection).update({'_id': segment}, {'$inc': eventCollections[collection][segment]}, {'upsert': true});
                }
            }
        }

        // update events collection
        if (eventArray.length) {
            var eventSegmentList = {'$addToSet': {'list': {'$each': eventArray}}};

            for (var event in eventSegments) {
                if (!eventSegmentList['$addToSet']["segments." + event.replace(params.app_id, "")]) {
                    eventSegmentList['$addToSet']["segments." + event.replace(params.app_id, "")] = {};
                }

                if (eventSegments[event]['meta.segments']) {
                    eventSegmentList['$addToSet']["segments." + event.replace(params.app_id, "")] = eventSegments[event]['meta.segments'];
                }
            }

            common.db.collection('events').update({'_id': params.app_id}, eventSegmentList, {'upsert': true}, function(err, res){});
        }
    };

    function logCurrUserEvents = function(apps) {
        var user = {};
        var action = {};
        for (j=0; j<apps.length; j++) {
            if (app[j].events) {
                var eventList = app[j].events;
                //console.log('events:%j', events);
                for ( i=0; i<eventList.length; i++) {
                    var e = eventList[i];
                    var key = e.key;
                    if (key == '_UMA_ID') {
                        if (e.segmentation.google_play_advertising_id) 
                            user.google_play_advertising_id = e.segmentation.google_play_advertising_id;
                        if (e.segmentation.android_id) 
                            user.android_id = e.segmentation.android_id;
                        if (e.segmentation.identifier_for_vendor) 
                            user.identifier_for_vendor = e.segmentation.identifier_for_vendor;
                    } else {
                        //console.log(e);            
                        computeCnt(e, key, action);
                        if (e.segmentation) {
                            for (var prop in e.segmentation) {
                                var prop_key = key+'.'+prop;
                                //console.log(prop_key);
                                computeCnt(e, prop_key, action);
                                //console.log("value:"+e.segmentation[prop]);
                                computeCnt(e, prop_key+'.'+e.segmentation[prop], action);                    
                            }
                        }
                    }

                }
            }
            console.log('user:%j', user);
            console.log('action:%j', action);
        }
        user.device_id = app[length-1].device_id;
        user.timestamp = app[length-1].timestamp;
        user.tz = app[length-1].tz;
        user.country = app[length-1].user.country;

        db.collection('ibb_'+app.app_id).update({device_id:user.device_id}, {$set:user, $inc:action}
            , {upsert:true}, function(err, res) {
                if (err){
                    console.log('userEvent log error:' + err);  
                }
            });
        );

        function computeCnt(e, key, action) {
            var cnt = e.count||1;
            //console.log('add key:'+key);
            if (typeof action[key+'.cnt'] != 'undefined') {
                action[key+'.cnt'] += cnt;
            } else {
                action[key+'.cnt'] = cnt;
            }
            if (e.sum) {
                if (action.hasOwnProperty(key+'.sum')) {
                    action[key+'.sum'] += e.sum;
                } else {
                    action[key+'.sum'] = e.sum;
                }
            }
        }
    }

} (events));

module.exports = events;
