
var countlyConfig = {
    mongodb: {
        host: "localhost",
        hostbatch: "localhost",
        db: "countly",
        db_raw: "countly_raw0",
        db_batch: "countly_raw1",
        db_ibb: "countly_snow_ibb",
        port: 27017,
        max_pool_size: 1000
    },
    /*  or for a replica set
    mongodb: {
        replSetServers : [
            '192.168.3.1:27017/?auto_reconnect=true',
            '192.168.3.2:27017/?auto_reconnect=true'
        ],
        db: "countly",
        max_pool_size: 1000
    },
    */
    /*  or define as a url
    mongodb: "localhost:27017/countly?auto_reconnect=true",
    */
    api: {
        workers: 0,
        port: 3001,
        host: "localhost",
        safe: false,
        session_duration_limit: 3601,
        max_sockets: 1024,
        cl_endsession_ongoing_timeout: 1,
        cl_wait_time: 5,
        cl_is_debug: false,
        cl_process_user_cnt: 3000,
        cl_wait_for_process: 2000,        /*
            If the last end_session is received less than 1 seconds ago we will ignore
            current begin_session request and mark this user as having an ongoing session
        */
        city_data: true
    },
    apps: {
        country: "TR",
        timezone: "Europe/Istanbul",
        category: "6"
    }
};

// Set your host IP or domain to be used in the emails sent
// countlyConfig.host = "YOUR_IP_OR_DOMAIN";

module.exports = countlyConfig;
