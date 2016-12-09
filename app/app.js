let smartcard;
const electron = require('electron');
const fs = require('fs-extra');
const sqlite3 = require('sqlite3');
const path = require('path');
const eapp = electron.remote.app;
let Devices;
let devices;
let currentDevices = [];
let db;
let intervalId = undefined;
let progressInterval = undefined;
const dataPath = path.join(eapp.getPath('appData'),'student-check-electron-angular');
const photoPath = path.join(dataPath,'pics');
///Users/liupeiqi/Library/Application Support/student-check-electron-angular/pics
const domain = "http://hn2.guardiantech.com.cn:10492/v2/";
const placeHolderPic = 'http://placekitten.com/300/450';

/**
 * standardize nulls
 * @param s if input is null, undefined, 'null'(of any cases)
 * @returns {string} return '' else s
 */
let standardize = function (s) {
    return !s || s.toUpperCase() == 'NULL' ? '' : s;
};

// let pref = {
//     /**
//      * Initialize the local pref, return value after init
//      * @param key self-explanatory
//      * @param moren default value for this key is value DNE
//      */
//     init:function (key, moren) {
//         if (window.localStorage.getItem(key) === null){
//             window.localStorage.setItem(key,moren);
//         }
//         return window.localStorage.getItem(key);
//     },
//     set: function (key, val) {
//         window.localStorage.setItem(key,val);
//     },
//     get: function (key) {
//         return window.localStorage.getItem(key);
//     }
// };
let settings = ['show-add-student','show-rm-student','show-reg-student','hide-repeat','progress-bar'];
let needDownloadDB = false;
let app = angular.module("studentCheck", ['ngRoute', 'routeStyles','ngAnimate', 'toastr','frapontillo.bootstrap-switch','ui.bootstrap','ui.bootstrap.datetimepicker'], function ($httpProvider) {
    $httpProvider.defaults.headers.post['Content-Type'] = 'application/x-www-form-urlencoded;charset=utf-8';
    let param = function (obj) {
        let query = '', name, value, fullSubName, subName, subValue, innerObj, i;

        for (name in obj) {
            value = obj[name];

            if (value instanceof Array) {
                for (i = 0; i < value.length; ++i) {
                    subValue = value[i];
                    fullSubName = name + '[' + i + ']';
                    innerObj = {};
                    innerObj[fullSubName] = subValue;
                    query += param(innerObj) + '&';
                }
            }
            else if (value instanceof Object) {
                for (subName in value) {
                    subValue = value[subName];
                    fullSubName = name + '[' + subName + ']';
                    innerObj = {};
                    innerObj[fullSubName] = subValue;
                    query += param(innerObj) + '&';
                }
            }
            else if (value !== undefined && value !== null)
                query += encodeURIComponent(name) + '=' + encodeURIComponent(value) + '&';
        }

        return query.length ? query.substr(0, query.length - 1) : query;
    };
    // Override $http service's default transformRequest
    $httpProvider.defaults.transformRequest = [function (data) {
        return angular.isObject(data) && String(data) !== '[object File]' ? param(data) : data;
    }];
});

app.run(function ($rootScope, toastr) {
    smartcard = require('smartcard');
    Devices = smartcard.Devices;
    devices = new Devices();

    let registerDevices = function (event) {
        currentDevices = event.devices;
        currentDevices.forEach(function (device) {
            device.on('card-inserted', event => {
                let card = event.card;
                console.log(`Card '${card.getAtr()}' inserted into '${card.device}'`);
                $rootScope.$broadcast('card-attach', card.getAtr());
            });
            device.on('card-removed', event => {
            });
            device.on('error', event => {
                toastr.error('Card reading error! Please try again!');
                console.error("Card reading error: " + event);
            });
        });
    };

    devices.on('device-activated', event => {
        console.log("Reader added :" + event.device);
        registerDevices(event);
    });

    devices.on('device-deactivated', event => {
        console.log("Reader removed :" + event.device);
        registerDevices(event);
    });

    devices.on('error', event =>{
        toastr.error('Card reader error! Please restart the program!');
        console.error("card reader error: " + event);
    });

    $rootScope.isLoggedIn = false;
    $rootScope.downloadStudentInfoInProgress = false;
    $rootScope.downloadEventsInProgress = false;
    $rootScope.downloadPicsInProgress = false;
    $rootScope.uploadRegisterInProgress = false;
});

app.factory("session", function () {
    return {
        get: function (key) {
            return window.sessionStorage.getItem(key);
        },
        set: function (key, value) {
            window.sessionStorage.setItem(key, value);
        },
        remove: function (key) {
            window.sessionStorage.removeItem(key);
        },
        clear: function () {
            window.sessionStorage.clear();
        }
    };
});
app.factory('httpInterceptor', function ($q, $injector, session) {
    let httpInterceptor = {
        'responseError': function (response) {
            return $q.reject(response);
        },
        'response': function (response) {
            return response;
        },
        'request': function (config) {
            if (session.get("token") !== undefined && session.get("token") != "") {
                config.headers['Authorization'] = session.get("token");
            }
            return config;
        },
        'requestError': function (config) {
            return $q.reject(config);
        }
    };
    return httpInterceptor;
});
//Network & DB
app.factory('syncManager', function ($http, toastr, session, $rootScope) {
    let checkErr = function (err) {
        if ($rootScope.isLoggedIn) {
            if (err.status === 401) {
                $http.post(domain + 'api/auth/verify', {}).then(function (suc) {
                        //No permission
                        toastr.error('You do not have permission to do this! ' + suc.data.emoticon);
                        return true;
                    },
                    function (error) {
                        //Token timeout
                        $rootScope.isLoggedIn = false;
                        session.clear();
                        window.location.href = '#/home';
                        toastr.error('You have been idling for too long and you are logged out!');
                        return false;
                    });
            } else {
                return true;
            }
        }
        return true;
    };
    return {
        backup: function (callback) {
            fs.ensureDir(path.join(dataPath,'backup'),function (err) {
                if (err){
                    callback(false);
                }else {
                    let fileName = new Date().toISOString().split(':').join('.') + '.db';
                    fs.ensureFile(path.join(dataPath,'backup', fileName), function (err) {
                        if (err){
                            callback(false);
                        }else {
                            fs.copy(path.join(dataPath,'AOFCheckDB.db'), path.join(dataPath, 'backup', fileName),function (err) {
                                if (err){
                                    callback(false);
                                }else {
                                    callback(true);
                                }
                            });
                        }
                    });
                }
            });

        },
        downloadStudentInfo: function (callback) {
            $http.get(domain + 'api/student/all').then(function (result) {
                db.serialize(function () {
                    db.run("BEGIN TRANSACTION");
                    db.run("DELETE FROM `StudentInfo`");
                    let stmt = db.prepare("INSERT OR REPLACE INTO `StudentInfo` ('id','firstName','lastName','nickName','rfid','dorm') VALUES (?,?,?,?,?,?)");
                    for (let i = 0; i < result.data.students.length; i++) {
                        let student = result.data.students[i];
                        stmt.run([student.studentId, student.firstName, student.lastName, student.nickName, student.rfid, student.dorm]);
                    }
                    stmt.finalize();
                    db.run("COMMIT");
                    callback(true);
                });
            }, function (error) {
                if (checkErr(error)) callback(false);
            });
        },
        /**
         * Download event list
         * @param callback return events while succeed, return null if failed
         */
        downloadEvents: function (callback) {
            $http.get(domain + 'api/event/list').then(function (result) {
                callback(result.data.events);
            }, function (error) {
                if (checkErr(error)) callback(null);
            });
        },
        /**
         * Download event detail (students)
         * @param eventId Event ID
         * @param callback return students while succeed, return null if failed
         */
        downloadEventStudents: function (eventId, callback) {
            $http.get(domain + 'api/event/' + eventId + '/detail').then(function (result) {
                callback(result.data.students);
            }, function (error) {
                if (checkErr(error)) callback(null);
            });
        },
        downloadPics: function (callback) {
            console.log(photoPath);
            fs.ensureDirSync(photoPath);
            db.each("SELECT * FROM `StudentInfo`", [], function (err, row) {
                    $http.get(domain + 'api/student/' + row.id + '/image', {responseType: 'arraybuffer'}).then(function (result) {
                        let f = fs.createWriteStream(photoPath + '/' + row.id + '.jpg');
                        f.write(Buffer.from(result.data), function (err, written, string) {
                            if (err) console.warn(err.code);
                            // else console.log('write file succeed @' + row.id);
                            f.close();
                        });
                        callback(true, null);
                    }, function (error) {
                        toastr.warning('http error occur @' + row.id + ' :' + error);
                        callback(true, null);
                    });
                },
                function (err, rowN) {
                    callback(false, rowN);
                });
        },

        /**
         * Upload add students to server
         * @param students Array of students, need at least id, inTime, outTime
         * @param eventId Event ID
         * @param callback true if succeed, false if failed;
         */
        uploadAddStudent: function (students, eventId, callback) {
            let addArr = [];
            students.forEach(function (stu) {
                addArr.push({
                    id: stu.id.toString(),
                    checkin: stu.inTime.toString(),
                    checkout: stu.outTime.toString()
                });
            });
            $http.post(domain + 'api/event/' + eventId + '/add', {
                data: JSON.stringify({
                    add: addArr
                })
            }).then(function (suc) {
                callback(true);
            }, function (err) {
                if (checkErr(err)) callback(false);
            });

        },
        /**
         * Upload remove students to server
         * @param students Array of students, need at least id
         * @param eventId Event ID
         * @param callback true if succeed, false if failed;
         */
        uploadRemoveStudent: function (students, eventId, callback) {
            let rmArr = [];
            students.forEach(function (stu) {
                rmArr.push(stu.id.toString());
            });
            $http.post(domain + 'api/event/' + eventId + '/remove', {data: JSON.stringify({remove: rmArr})}).then(function (suc) {
                callback(true);
            }, function (err) {
                if (checkErr(err)) callback(false);
            });
        },
        uploadAddEvent: function (eventName, eventTime, callback) {
            $http.post(domain + 'api/event/add', {eventName: eventName, eventTime: eventTime.toString()}).then(function (suc) {
                callback(suc.data);
            }, function (err) {
                if (checkErr(err)) callback(null);
            });
        },
        uploadCompleteEvent: function (eventId, callback) {
            $http.post(domain + 'api/event/' + eventId + '/complete', {}).then(function (suc) {
                // if (local) {
                //     db.run("UPDATE `Events` SET `status` = ? WHERE `eventId` = ?", [2, eventId], function (err) {
                //         if (err) {
                //             console.warn('uploadCompleteEvent DB error:' + err);
                //         }
                //     });
                // }
                callback(true);
            }, function (err) {
                if (checkErr(err)) callback(false);
            });
        },
        /**
         * update student rfid
         * @param id student id
         * @param rfid new rfid
         * @param callback true if 200, else false
         */
        uploadRegister: function (id, rfid, callback) {
            $http.post(domain + 'api/student/' + id + '/update', {rfid: rfid}).then(function (suc) {
                db.run('UPDATE `StudentInfo` SET `rfid` = ? WHERE id = ?', [rfid, id], function (err) {
                    if (err) {
                        console.warn('uploadRegister DB error:' + err);
                    }
                    callback(true);
                });
            }, function (err) {
                if (checkErr(err)) callback(false);
            })
        },
        uploadCheckoutEvent: function (eventId, callback) {
            $http.post(domain + 'api/event/' + eventId + '/checkout', {}).then(
                function (suc) {
                    callback(suc.data);
                },
                function (err) {
                    if (checkErr(err)) callback(null);
                }
            );
        },
        uploadGiveBackEvent: function (event, callback) {
            $http.post(domain + 'api/event/' + event.eventId + '/return', {authKey: event.token}).then(
                function (suc) {
                    callback(true);
                },
                function (err) {
                    if (checkErr(err)) callback(false);
                }
            );
        },
        sendEmails: function (emails, event, callback) {
            $http.post(domain + 'api/event/' + event.eventId + '/send', {recipients: JSON.stringify({recipients: emails})}).then(
                function (suc) {
                    callback(true);
                },
                function (err) {
                    if (checkErr(err)) callback(false);
                }
            );
        }
    };
});
app.factory('LS', function ($window, $rootScope) {
    // angular.element($window).on('storage', function(event) {
    //     if (settings.indexOf(event.key) > -1){
    //         $rootScope.$apply();
    //     }
    // });
    return {
        set: function(key, val) {
            $window.localStorage.setItem(key, val);
            return this;
        },
        get: function(key, defaul) {
            if (defaul !== null && defaul !== undefined && $window.localStorage.getItem(key) === null){
                $window.localStorage.setItem(defaul);
            }
            return $window.localStorage.getItem(key);
        }
    };
});

app.config(['$httpProvider', function ($httpProvider) {
    $httpProvider.interceptors.push('httpInterceptor');
}]);
app.config(function ($routeProvider) {
    $routeProvider
        .when("/login", {
            templateUrl: 'templates/login.ng',
            controller: 'loginCtrl',
        })
        .when("/home", {
            templateUrl: 'templates/home.ng',
            controller: 'homeCtrl'
        })
        .when("/event", {
            templateUrl: 'templates/event.ng',
            controller: 'eventCtrl'
        })
        .when("/checkin/:eventId", {
            templateUrl: 'templates/checkin.ng',
            controller: 'checkinCtrl'
        })
        .when("/advanced", {
            templateUrl: 'templates/advanced.ng',
            controller: 'advancedCtrl'
        })
        .when("/events", {
            templateUrl: 'templates/events.ng',
            controller: 'eventsCtrl'
        })
        .when("/register", {
            templateUrl: 'templates/register.ng',
            controller: 'regCtrl'
        })
        .when("/settings", {
            templateUrl: 'templates/settings.ng',
            controller: 'settingsCtrl'
        })
        .otherwise({
            templateUrl: 'templates/index.ng',
            controller: 'indexCtrl'
        });
});
app.config(function(toastrConfig) {
    if (window.localStorage.getItem('progress-bar')===null){
        window.localStorage.setItem('progress-bar',true);
    }
    if (window.localStorage.getItem('hide-repeat')===null){
        window.localStorage.setItem('hide-repeat',false);
    }
    angular.extend(toastrConfig, {
        autoDismiss: false,
        maxOpened: 0,
        newestOnTop: false,
        positionClass: 'toast-bottom-right',
        progressBar: window.localStorage.getItem('progress-bar') == 'true',
        timeOut: 5000,
        preventOpenDuplicates: window.localStorage.getItem('hide-repeat') == 'true',
        messageClass: 'toast-msg-lg'
    });
});

app.directive('autofocus', ['$timeout', function ($timeout) {
    return {
        restrict: 'A',
        link: function ($scope, $element) {
            $timeout(function () {
                $element[0].focus();
            });
        }
    }
}]);

app.controller("navbarCtrl", function ($rootScope, $scope, $http, session, $location, toastr) {
    $scope.$watch(
        function () {
            return $rootScope.isLoggedIn;
        },
        function (newVal, oldVal) {
            if (newVal != oldVal) {
                $scope.username = session.get('username');
            }
        }
    );
    $scope.logIO = function () {
        if ($scope.isLoggedIn) {
            session.clear();
            $rootScope.isLoggedIn = false;
            if (intervalId){clearInterval(intervalId); intervalId = undefined;}
            if (progressInterval){clearInterval(progressInterval); progressInterval = undefined;}
            toastr.info('You have logged out');
            $location.url('/home');
        } else {
            $location.url('/login');
        }
    };

    let list = function (evokeChange) {
        if (evokeChange){
            if (intervalId){clearInterval(intervalId); intervalId = undefined;}
            if (progressInterval){clearInterval(progressInterval); progressInterval = undefined;}
        }
        let url = '';
        switch ('/' + $location.url().split('/')[1]) {
            // case '/home':
            //     url = '/login';
            //     break;
            case '/event':
                url = '/home';
                break;
            case '/checkin':
                if ($rootScope.isLoggedIn){
                    url = '/event';
                }
                else {url = '/home';}
                break;
            case '/advanced':
                url = '/home';
                break;
            case '/events':
                url = '/home';
                break;
            case '/register':
                url = '/home';
                break;
            case '/settings':
                url = '/home';
        }
        return url;
    };
    $scope.isBackNeed = function () {
        return list(false) != '';
    };
    $scope.goBack = function () {
        /*window.history.back();*/
        let url = list(true);
        if (url != '') {
            $location.url(url);
        }
    };
});
app.controller('indexCtrl', function ($rootScope) {
    if (window.localStorage.getItem('show-add-student')===null){
        window.localStorage.setItem('show-add-student',true);
    }
    if (window.localStorage.getItem('show-rm-student')===null){
        window.localStorage.setItem('show-rm-student',true);
    }
    if (window.localStorage.getItem('show-reg-student')===null){
        window.localStorage.setItem('show-reg-student',true);
    }
    db = new sqlite3.Database(path.join(dataPath,'AOFCheckDB.db'), function (error) {
        if (error) console.warn("Failed to initialize database :" + error);
        else {
            db.exec(
                "CREATE TABLE if not exists StudentInfo      " +
                "(id        TEXT PRIMARY KEY UNIQUE NOT NULL," +
                " firstName TEXT                            ," +
                " lastName  TEXT                            ," +
                " nickName  TEXT                            ," +
                " rfid      TEXT                            ," +
                " dorm      TEXT                           );" +
                "CREATE TABLE if not exists StudentCheck     " +
                "(id        TEXT                    NOT NULL," +
                " eventId   TEXT                    NOT NULL," +
                " inTime    TEXT                            ," +
                " outTime   TEXT                            ," +
                " status    INTEGER                         ," +
                " PRIMARY KEY (id, eventId)             );" +
                "CREATE TABLE if not exists StudentReg       " +
                "(id        TEXT PRIMARY KEY UNIQUE NOT NULL," +
                " rfid      TEXT                           );" +
                "CREATE TABLE if not exists Events           " +
                "(eventId   TEXT PRIMARY KEY UNIQUE NOT NULL," +
                " eventName TEXT                            ," +
                " eventTime TEXT                            ," +
                " token     TEXT                            ," +
                " status    TEXT                           ) ",
                function (error) {
                    if (error) console.warn("Failed to create table: " + error);
                    else {
                        $rootScope.localEvent = undefined;
                        db.get('SELECT * FROM `EVENTS`',[],function (err, row) {
                            if (row){
                                $rootScope.localEvent = {
                                    eventId : row.eventId,
                                    eventName : row.eventName,
                                    eventTime : row.eventTime,
                                    token : row.token,
                                    eventStatus : row.status
                                };
                            }
                            db.get("SELECT count(*) AS cnt FROM `StudentInfo`",[],function (err, row) {
                                if (!row.cnt){
                                    needDownloadDB = true;
                                }
                                window.location.href = "#/login";
                            });
                        });
                    }
                });
        }
    });
});
app.controller('loginCtrl', function ($scope, $http, session, $rootScope, toastr) {
    // $scope.username = 'admin';
    // $scope.password = '12345';
    $scope.isLoggingIn = false;
    $scope.login = function () {
        $scope.isLoggingIn = true;
        $http.post(domain + "api/auth", {username: $scope.username, password: calcMD5($scope.password)})
            .then(function (result) {
                    session.set("token", result.data.token);
                    session.set("username", $scope.username);
                    $rootScope.isLoggedIn = true;
                    toastr.success('You have logged in!');
                    window.location.href = "#/home";
                },
                function (failResult) {
                    $scope.password = "";
                    $scope.isLoggingIn = false;
                    toastr.error("Sign In Failed: " + JSON.stringify(failResult.data),{timeOut:10000});
                });
    }
});
app.controller('homeCtrl', function ($scope, $rootScope, toastr, syncManager) {
    if (needDownloadDB){
        if ($rootScope.isLoggedIn){
            if (!$rootScope.downloadStudentInfoInProgress) {
                $rootScope.downloadStudentInfoInProgress = true;
                syncManager.downloadStudentInfo(function (ret) {
                    if (ret){
                        needDownloadDB = false;
                        $rootScope.downloadStudentInfoInProgress = false;
                    }else {
                        toastr.warning('Failed to download DB!');
                    }
                });
            }
        }else {toastr.warning('Your database is empty! please log in!');}
    }
    $scope.goCheckin = function () {
        if (!$rootScope.localEvent) {
            if ($rootScope.isLoggedIn)
                window.location.href = "#/event";
            else
                toastr.warning("Please log in and go to Events menu to check out an event!",{timeOut:10000});
        } else {
            if
            ($rootScope.isLoggedIn) toastr.warning("Please go to Events menu to give back the local event!",{timeOut:10000});
            else {
                toastr.info('You are checking in for event "' + $rootScope.localEvent.eventName + '"');
                window.location.href = "#/checkin/" + $rootScope.localEvent.eventId;
            }

        }
    };
    $scope.goEvents = function () {
        if ($rootScope.isLoggedIn) {
            window.location.href = "#/events";
        }
    };
    $scope.goReg = function () {
        if ($rootScope.isLoggedIn) {
            if (!$rootScope.localEvent){
                window.location.href = "#/register";
            }else {
                toastr.warning("Please go to Events menu to give back the local event!",{timeOut:10000});
            }
        }
    };
    $scope.goAdvanced = function () {
        if ($rootScope.isLoggedIn) {
            window.location.href = "#/advanced";
        }
    }
});
app.controller('eventCtrl', function ($scope, $http, syncManager, toastr, $rootScope) {
    $scope.selected = undefined;
    $scope.events = [];

    let updateEvents = function () {
        syncManager.downloadEvents(function (ret1) {
            if (ret1){
                $scope.events = ret1;
            }else {
                toastr.error('Failed to fetch event list!',{timeOut:10000});
            }
        });
    };
    updateEvents();

    $scope.selectItem = function (item) {
        $scope.selected = item;
    };
    $scope.isActive = function (item) {
        return $scope.selected == item;
    };
    $scope.continueEvent = function () {
        console.log($scope.selected.eventId);
        toastr.info('You are checking in for event "' + $scope.selected.eventName + '"',{timeOut:10000});
        $rootScope.eventName = $scope.selected.eventName;
        window.location.href = "#/checkin/" + $scope.selected.eventId;
    };
    $scope.activeFilter = function (event) {
        return event.eventStatus != 2;
    };
});
app.controller('checkinCtrl', function ($scope, $routeParams, session, syncManager, $rootScope, toastr, LS) {
    $scope.students = [];
    let eventId = $routeParams.eventId;
    let lastUpdate = 0;

    db.all("SELECT * FROM `StudentInfo`", function (err, rows) {
        if (!rows){
            toastr.error('Database is empty! Please go to Advanced -> Download Students',{timeOut:10000});
        }else {
            rows.forEach(function (row) {
                $scope.students.push({
                    id: row.id,
                    firstName: row.firstName,
                    lastName: row.lastName,
                    nickName: row.nickName,
                    inTime: '',
                    outTime: '',
                    rfid: row.rfid,
                    dorm: row.dorm
                });
            });
        }

        if ($rootScope.isLoggedIn) {
            updateEventStudents();
            intervalId = setInterval(function(){updateEventStudents();},5000);
            progressInterval = setInterval(function () {
                $scope.refreshProgress = 100 - (new Date().getTime() - lastUpdate)/50;
                $scope.$apply();
            },50);
        }
        else {
            db.all("SELECT * FROM `StudentCheck` WHERE `eventId` = ?", [eventId], function (err, rows) {
                for (let i = 0; i < rows.length; i++) {
                    for (let k = 0; k < $scope.students.length; k++) {
                        if ($scope.students[k].id === rows[i].id) {
                            $scope.students[k].inTime = standardize(rows[i].inTime);
                            $scope.students[k].outTime = standardize(rows[i].outTime);
                            // console.log("id:" + $scope.students[k].id + " in:" + $scope.students[k].inTime + " out:" + $scope.students[k].outTime);
                            break;
                        }
                    }
                }
                $scope.$apply();
            });
        }
    });

    let updateEventStudents = function () {
        //TODO:loading
        console.log('Students updated');
        syncManager.downloadEventStudents(eventId, function (ret) {
            if (ret != null) {
                for (let k = 0; k < $scope.students.length; k++){
                    let found = false;
                    for (let i = 0; i < ret.length; i++) {
                        if ($scope.students[k].id === ret[i].studentId) {
                            $scope.students[k].inTime = standardize(ret[i].checkinTime);
                            $scope.students[k].outTime = standardize(ret[i].checkoutTime);
                            found = true;
                            break;
                        }
                    }
                    if (!found){
                        $scope.students[k].inTime = '';
                        $scope.students[k].outTime = '';
                    }
                }
            }
            lastUpdate = new Date().getTime();
        });
    };
    $scope.manualUpdate = function () {
        updateEventStudents();
    };

    $scope.q = '';
    $scope.pic = placeHolderPic;
    $scope.fn = 'First Name';
    $scope.ln = 'Last Name';
    $scope.nn = 'Nickname';
    $scope.registerRFID = undefined;
    $scope.networkInProgress = false;
    $scope.searchFilter = function (student) {
        if ($scope.q == '') {
            return $scope.isCheckedIn(student);
        } else {
            return student.lastName.substring(0, $scope.q.length).toLowerCase() === $scope.q.toLowerCase();
        }
    };
    $scope.isCheckedIn = function (student) {
        return student.inTime && !student.outTime;
    };
    $scope.getCheckinLen = function () {
        let n = 0;
        $scope.students.forEach(function (student) {
            if ($scope.isCheckedIn(student)) n++;
        });
        return n;
    };

    $scope.checkinStudent = function (stu) {
        $scope.networkInProgress = true;
        if ($scope.registerRFID)
            registerStudent(stu, $scope.registerRFID);
        if (!stu.inTime) {
            if ($rootScope.isLoggedIn) {
                //online
                let stuTmp = angular.copy(stu);
                stuTmp.inTime = new Date().getTime().toString();
                doUploadAdd(stuTmp, 0);
            } else {
                //offline
                let time = new Date().getTime().toString();
                db.get("SELECT * FROM `StudentCheck` WHERE `id` = ? AND `eventId` = ?",[stu.id,eventId],function (err, row) {
                    if (!err){
                        db.run("INSERT OR REPLACE INTO `StudentCheck` ('id','eventId','inTime','outTime','status') VALUES (?,?,?,?,?)", [stu.id, eventId, time, stu.outTime, row?parseInt(row.status)+1:1], function (err) {
                            if (!err) {
                                stu.inTime = time;
                                $scope.q = '';
                                $scope.networkInProgress = false;
                                if(LS.get('show-add-student')=='true')toastr.success(stu.nickName + " is checked in!");
                                showStudent(stu, false);
                            }else {
                                throw err;
                            }
                        });
                    }else {
                        throw err;
                    }
                });
            }
        } else {
            $scope.networkInProgress = false;
            showStudent(stu, false);
        }
    };
    let doUploadAdd = function (s, cnt) {
        if (cnt < 3) {
            syncManager.uploadAddStudent([s], eventId, function (ret) {
                if (!ret) {
                    console.warn("upload add failed @ attempt" + cnt);
                    doUploadAdd(s, cnt + 1);
                } else {
                    for (let i = 0; i < $scope.students.length; i++) {
                        if (s.id == $scope.students[i].id) {
                            $scope.students[i].inTime = s.inTime;
                            $scope.networkInProgress = false;
                            $scope.q = '';
                            showStudent(s, true);
                            if(LS.get('show-add-student')=='true')toastr.success(s.nickName + " is checked in!");
                            break;
                        }
                    }
                }
            });
        } else {
            toastr.error(s.nickName + " is not checked in due to network error! Please try again!",{timeOut:10000});
            $scope.networkInProgress = false;
        }
    };

    let dispTimeout = undefined;
    let showStudent = function (student, changed) {
        if (dispTimeout !== undefined)
            clearTimeout(dispTimeout);
        if (fs.existsSync(photoPath + '/' + student.id + '.jpg')){
            $scope.pic = photoPath + '/' + student.id + '.jpg';
        }else {
            $scope.pic = 'http://wiki.bdtnrm.org.au/images/8/8d/Empty_profile.jpg';
            toastr.error('Photo not found, please go to Advanced -> Download Photos');
        }
        $scope.fn = student.firstName;
        $scope.ln = student.lastName;
        $scope.nn = student.nickName;
        if (!changed)
            $scope.$apply();
        dispTimeout = setTimeout(function () {
            console.log('its high noon');
            $scope.pic = placeHolderPic;
            $scope.fn = 'First Name';
            $scope.ln = 'Last Name';
            $scope.nn = 'Nickname';
            $scope.$apply();
        }, 5000);
    };

    $scope.deleteStudent = function (stu) {
        $scope.networkInProgress = true;
        if ($rootScope.isLoggedIn) {
            doUploadRm(stu, 0);
        } else {
            db.run("UPDATE `StudentCheck` SET status = status - 1, `inTime` = ? WHERE `id` = ? AND `eventId` = ?", ['', stu.id, eventId], function (err) {
                if (!err) {
                    stu.inTime = '';
                    console.log(stu + " removed");
                    $scope.q = '';
                    $scope.networkInProgress = false;
                    if(LS.get('show-rm-student')=='true')toastr.success(stu.nickName + " is removed!");
                    showStudent(stu, false);
                }
            });
        }
    };
    let doUploadRm = function (s, cnt) {
        if (cnt < 3) {
            syncManager.uploadRemoveStudent([s], eventId, function (ret) {
                if (!ret) {
                    console.warn("upload remove failed @ attempt" + cnt);
                    doUploadRm(s, cnt + 1);
                } else {
                    for (let i = 0; i < $scope.students.length; i++) {
                        if (s.id == $scope.students[i].id) {
                            $scope.students[i].inTime = '';
                            $scope.networkInProgress = false;
                            console.log($scope.students[i].firstName + " removed");
                            $scope.q = '';
                            if(LS.get('show-rm-student')=='true')toastr.success(s.nickName + " is removed!");
                            showStudent($scope.students[i], true);
                            break;
                        }
                    }
                }
            });
        } else {
            toastr.error(s.nickName + " is not removed due to network error! Please try again!",{timeOut:10000});
            $scope.networkInProgress = false;
        }
    };

    let registerStudent = function (stu, rfid) {
        if ($rootScope.isLoggedIn) {
            let stuTmp = angular.copy(stu);
            stuTmp.rfid = rfid;
            doUploadReg(stuTmp, 0);
        } else {
            db.serialize(function () {
                db.run("INSERT OR REPLACE INTO `StudentReg` ('id','rfid') VALUES (?,?)", [stu.id, rfid.toUpperCase()]);
                db.run("UPDATE `StudentInfo` SET `rfid` = ? WHERE `id` = ?", [rfid.toUpperCase(), stu.id]);
                $scope.registerRFID = undefined;
                stu.rfid = rfid;
                if(LS.get('show-reg-student')=='true')toastr.success(stu.nickName + " is registered!");
            });
        }

    };
    let doUploadReg = function (s, cnt) {
        if (cnt < 3) {
            syncManager.uploadRegister(s.id, s.rfid, function (ret) {
                if (!ret) {
                    console.warn("upload remove failed @ attempt" + cnt);
                    doUploadReg(s, cnt + 1);
                } else {
                    for (let i = 0; i < $scope.students.length; i++) {
                        if (s.id == $scope.students[i].id) {
                            $scope.registerRFID = undefined;
                            $scope.students[i].rfid = s.rfid;
                            if(LS.get('show-reg-student')=='true')toastr.success(s.nickName + " is registered!");
                            break;
                        }
                    }

                }
            });
        } else {
            toastr.error(s.nickName + " is not registered due to network error! Please try again!",{timeOut:10000});
            $scope.networkInProgress = false;
        }
    };

    $scope.$on('card-attach', function (event, rfid) {
        db.get('SELECT * FROM `StudentInfo` WHERE `rfid` = ? COLLATE NOCASE', [rfid], function (err, row) {
            if (!err) {
                if (!row) {
                    // console.log('card DNE in DB');
                    toastr.info('Please register this card!');
                    $scope.registerRFID = rfid.toUpperCase();
                    $scope.$apply();
                } else {
                    $scope.students.forEach(function (stu) {
                            if (row.id === stu.id) {
                                $scope.checkinStudent(stu);
                            }
                        }
                    );
                }
            } else {
                console.warn('failed query from DB :' + err);
            }
        });
    })

});
app.controller('advancedCtrl', function ($scope, syncManager, toastr, $rootScope) {
    $scope.downloadStudentInfo = function () {
        if (!$rootScope.downloadStudentInfoInProgress) {
            $rootScope.downloadStudentInfoInProgress = true;
            syncManager.downloadStudentInfo(function (ret) {
                $rootScope.downloadStudentInfoInProgress = false;
            });
        }
    };
    $scope.downloadEvents = function () {
        if (!$rootScope.downloadEventsInProgress) {
            $rootScope.downloadEventsInProgress = true;
            syncManager.downloadEvents(function (ret) {
                $rootScope.downloadEventsInProgress = false;
            });
        }
    };
    $scope.downloadPics = function () {
        if (!$rootScope.downloadPicsInProgress) {
            $scope.value = 0;
            $rootScope.downloadPicsInProgress = true;
            syncManager.downloadPics(function (cur, max) {
                if (max != null) {
                    $scope.maxv = max
                }
                if (cur) ++$scope.value;
                if ($scope.value >= $scope.maxv) {
                    $rootScope.downloadPicsInProgress = false;
                }
            });
        }
    };
    $scope.removePics = function () {
        fs.removeSync(photoPath);
    };
    $scope.uploadRegister = function () {
        if (!$rootScope.uploadRegisterInProgress) {
            $rootScope.uploadRegisterInProgress = true;
            db.all("SELECT * FROM `StudentReg`",[],function (err, rows) {
                if (rows.length > 0){
                    let cnt = 0;
                    rows.forEach(function (row) {
                        syncManager.uploadRegister(row.id, row.rfid, function (ret) {
                            if (ret){
                                syncManager.backup(function (backUpSuc) {
                                    if (backUpSuc){
                                        db.run("DELETE FROM `StudentReg` WHERE `id` = ?",[row.id],function (err) {
                                            cnt += 1;
                                            if (cnt >= rows.length){
                                                $rootScope.uploadRegisterInProgress = false;
                                                $scope.$apply();
                                            }
                                        });
                                    }else {
                                        toastr.error('Backup failed! DB modification aborted!');
                                    }
                                });
                            }else {
                                toastr.error('Failed uploading a student... Try do it again');
                                cnt += 1;
                                if (cnt >= rows.length){
                                    $rootScope.uploadRegisterInProgress = false;
                                    $scope.$apply();
                                }
                            }
                        });
                    });
                }else {
                    toastr.info('No need for upload!');
                    $rootScope.uploadRegisterInProgress = false;
                    $scope.$apply();
                }
            });
        }
    };
    $scope.value = 0;
    $scope.maxv = 100;

});
app.controller('eventsCtrl', function ($scope, $http, syncManager, toastr, $rootScope) {
    $scope.selected = undefined;
    $scope.events = [];
    $scope.eventName = '';
    $scope.networkInProgress = true;
    $scope.selectedDate = new Date().getTime()/1000|0;

    let lastUpdate = 0;

    $scope.openDate = function(){
        $scope.dateOpened = true;
    };

    $scope.onTimeSet = function (newDate, oldDate) {
        // console.log(newDate);
        $scope.dateOpened = false;
        $scope.selectedDate = new Date(newDate).getTime()/1000|0;
    };

    if ($rootScope.localEvent){
        toastr.info('You have a local event "'+ $rootScope.localEvent.eventName + '"');
    }

    let updateEvents = function () {
        syncManager.downloadEvents(function (ret1) {
            if (ret1 === null){
                toastr.error('Failed to fetch event list!',{timeOut:10000});
            }else {
                $scope.events = ret1;
                $scope.networkInProgress = false;
            }
            lastUpdate = new Date().getTime();
        });
    };
    if ($rootScope.isLoggedIn){
        updateEvents();
        intervalId = setInterval(function () {
            updateEvents();
        },10000);
        progressInterval = setInterval(function () {
            $scope.refreshProgress = 100 - (new Date().getTime() - lastUpdate)/100;
            $scope.$apply();
        },50);
    }

    $scope.selectItem = function (item) {
        $scope.selected = item;
        if ($scope.confirmingComplete) $scope.confirmingComplete = false;
    };
    $scope.isActive = function (item) {
        return $scope.selected == item;
    };
    $scope.activeFilter = function (event) {
        return event.eventStatus != 2;
    };
    $scope.addEvent = function () {
        $scope.networkInProgress = true;
        let n = angular.copy($scope.eventName);
        // console.log($scope.selectedDate);
        syncManager.uploadAddEvent(n, $scope.selectedDate, function (ret) {
            if (ret !== null) {
                toastr.success('Event "' + n + '" added!');
                updateEvents();
                $scope.networkInProgress = false;
                $scope.eventName = '';
            }else {
                toastr.error('Failed to add event!',{timeOut:10000});
                $scope.networkInProgress = false;
            }
        });
    };

    $scope.confirmingComplete = false;
    $scope.makeSureComplete = function () {
        if ($scope.confirmingComplete){
            completeEvent();
        }else {
            $scope.confirmingComplete = true;
        }
        // toastr.info('Click here to confirm complete!',{
        //     onHidden: function (clicked, toast) {
        //         if (clicked) completeEvent(); else $scope.networkInProgress = false;
        //     }});
    };

    let completeEvent = function () {
        // if (confirm('Do you really want to complete this event?')) {
        $scope.networkInProgress = true;
        let evt = angular.copy($scope.selected);
        syncManager.uploadCompleteEvent(evt.eventId, function (ret) {
            if (ret) {
                toastr.success('Completed event "' + evt.eventName + '"');
                updateEvents();
                $scope.networkInProgress = false;
            }else {
                toastr.error('Failed to completed event "' + evt.eventName + '" !');
                $scope.networkInProgress = false;
            }
            $scope.selected = undefined;
        });
        // }
    };
    $scope.checkOutEvent = function () {
        $scope.networkInProgress = true;
        let evt = angular.copy($scope.selected);
        syncManager.uploadCheckoutEvent(evt.eventId, function (ret) {
            if (ret) {
                evt.token = ret.returnKey;
                db.run("INSERT OR REPLACE INTO `Events` ('eventId','eventName','eventTime','token','status') VALUES (?,?,?,?,?)", [evt.eventId, evt.eventName, evt.eventTime, evt.token, evt.eventStatus], function (err) {
                    if (!err) {
                        $rootScope.localEvent = evt;
                        db.serialize(function () {
                            db.run("BEGIN TRANSACTION");
                            let stmt = db.prepare("INSERT OR REPLACE INTO `StudentCheck` ('id','eventId','inTime','outTime','status') VALUES (?,?,?,?,0)");
                            ret.students.forEach(function (stu) {
                                stmt.run([stu.studentId, evt.eventId, standardize(stu.checkinTime), standardize(stu.checkoutTime)]);
                            });
                            stmt.finalize();
                            db.run("COMMIT");
                            toastr.success('Check out event "' + evt.eventName + '"');
                            updateEvents();
                            $scope.networkInProgress = false;
                        });
                    }
                });
            } else {
                toastr.error("Check out failed!",{timeOut:10000});
                $scope.networkInProgress = false;
            }
        });
    };
    $scope.uploadEvent = function () {
        $scope.networkInProgress = true;
        let evt = angular.copy($rootScope.localEvent);
        let add = [];
        let rm = [];
        let reg = [];
        db.all("SELECT * FROM `StudentCheck` WHERE `eventId` = ?", [evt.eventId], function (err, rows) {
            rows.forEach(function (row) {
                let stu = {
                    id: row.id,
                    inTime: row.inTime,
                    outTime: row.outTime
                };
                if (row.status == 1){
                    add.push(stu);
                }else if(row.status == -1){
                    rm.push(stu);
                }
            });
            // console.log(add.length);
            // console.log("add array created");
            db.all("SELECT * FROM `StudentReg`", [], function (err, rows) {
                rows.forEach(function (row) {
                    reg.push({
                        id: row.id,
                        rfid: row.rfid
                    });
                });
                // console.log("reg array created");
                uploadEvents(evt, add, rm, reg);
            });
        });
    };

    let uploadEvents = function (evt, add, rm, reg) {
        syncManager.uploadGiveBackEvent(evt, function (ret) {
            // console.log("uploadGiveBackEvent");
            if (ret) {
                syncManager.backup(function (backUpSuc) {
                    if (backUpSuc){
                        db.run("DELETE FROM `Events` WHERE `eventId` = ?", [evt.eventId], function (err) {
                            if (!err) {
                                $rootScope.localEvent = undefined;
                                syncManager.uploadAddStudent(add, evt.eventId, function (ret) {
                                    // console.log("uploadAddStudent");
                                    if (ret) {
                                        syncManager.uploadRemoveStudent(rm, event.eventId, function (ret) {
                                            if (ret){
                                                db.run("DELETE FROM `StudentCheck` WHERE `eventId` = ?", [evt.eventId], function (err) {
                                                    // console.log("DELETE FROM `StudentCheck`");
                                                    if (!err) {
                                                        if (reg.length == 0) {
                                                            toastr.success('Give back event "' + evt.eventName + '"');
                                                            updateEvents();
                                                            $scope.networkInProgress = false;
                                                            $scope.selected = undefined;
                                                        } else {
                                                            let cnt = 0;
                                                            reg.forEach(function (stu) {
                                                                syncManager.uploadRegister(stu.id, stu.rfid, function (ret) {
                                                                    cnt += 1;
                                                                    // console.log("uploadRegister");
                                                                    if (ret) {
                                                                        db.run("DELETE FROM `StudentReg` WHERE `id` = ?", [stu.id], function (err) {
                                                                            if (cnt >= reg.length) {
                                                                                toastr.success('Give back event "' + evt.eventName + '"');
                                                                                updateEvents();
                                                                                $scope.networkInProgress = false;
                                                                                $scope.selected = undefined;
                                                                            }
                                                                        });
                                                                    } else {
                                                                        // console.warn("update " + stu.id + " failed!");
                                                                        toastr.warning("Upload register error! Please go to advanced!",{timeOut:10000});
                                                                        if (cnt >= reg.length) {
                                                                            toastr.success('Give back event "' + evt.eventName + '"');
                                                                            updateEvents();
                                                                            $scope.networkInProgress = false;
                                                                            $scope.selected = undefined;
                                                                        }
                                                                    }
                                                                });
                                                            });
                                                        }
                                                    }else {
                                                        toastr.error("Database error!",{timeOut:10000});
                                                        $scope.networkInProgress = false;
                                                        $scope.selected = undefined;
                                                    }
                                                });
                                            }else {
                                                toastr.error("Remove students failed!",{timeOut:10000});
                                                $scope.networkInProgress = false;
                                                $scope.selected = undefined;
                                            }
                                        });
                                    }else {
                                        toastr.error("Add students failed!",{timeOut:10000});
                                        $scope.networkInProgress = false;
                                        $scope.selected = undefined;
                                    }
                                });
                            }else {
                                toastr.error("Database error!",{timeOut:10000});
                                $scope.networkInProgress = false;
                                $scope.selected = undefined;
                            }
                        });
                    }else {
                        toastr.error('Backup failed! DB modification aborted!',{timeOut:10000});
                    }
                });
            }else {
                toastr.error("Give back event failed!",{timeOut:10000});
                $scope.networkInProgress = false;
                $scope.selected = undefined;
            }
        });
    };

    $scope.emailAdr = '';
    $scope.sendEmail = function () {
        $scope.networkInProgress = true;
        let evt = angular.copy($scope.selected);
        let adr = angular.copy($scope.emailAdr.split(','));
        syncManager.sendEmails(adr,evt,function (ret) {
            if (ret){
                toastr.success('Emails sent!');
                $scope.emailAdr = '';
            }else {
                toastr.error('Emails failed to send!');
            }
            $scope.networkInProgress = false;
        });
    }
});
app.controller('regCtrl', function ($scope, syncManager, $rootScope, toastr) {
    $scope.students = [];
    $scope.q = '';
    $scope.pic = placeHolderPic;
    $scope.fn = 'First Name';
    $scope.ln = 'Last Name';
    $scope.nn = 'Nickname';
    $scope.regRfid = undefined;
    $scope.selectedStudent = undefined;
    $scope.networkInProgress = true;
    db.all("SELECT * FROM `StudentInfo`", function (err, rows) {
        rows.forEach(function (row) {
            $scope.students.push({
                id: row.id,
                firstName: row.firstName,
                lastName: row.lastName,
                nickName: row.nickName,
                inTime: '',
                outTime: '',
                rfid: row.rfid,
                dorm: row.dorm
            });
        });
        $scope.networkInProgress = false;
    });
    $scope.searchFilter = function (student) {
        return student.lastName.substring(0, $scope.q.length).toLowerCase() === $scope.q.toLowerCase()
            || student.id.toString().substring(0, $scope.q.length) === $scope.q;
    };

    $scope.$on('card-attach', function (event, rfid) {
        if (!$scope.regRfid) {
            $scope.regRfid = rfid;
            $scope.$apply();
            $('input[name=qInput]').focus();
            // toastr.info('Please register the owner of this card');
        }
    });
    $scope.selectItem = function (item) {
        $scope.selectedStudent = item;
    };
    $scope.isActive = function (item) {
        return $scope.selectedStudent == item;
    };
    $scope.registerStudent = function () {
        let stu = angular.copy($scope.selectedStudent);
        if ($rootScope.isLoggedIn)
            doReg(stu, $scope.regRfid, 0);
        else {
            db.run("INSERT OR REPLACE INTO `StudentReg` ('id','rfid') VALUES (?,?)", [stu.id, $scope.regRfid.toUpperCase()], function (err) {
                if (!err) {
                    db.run("UPDATE `StudentInfo` SET `rfid` = ? WHERE `id` = ?", [$scope.regRfid.toUpperCase(), stu.id], function (err) {
                        if (!err) {
                            $scope.regRfid = undefined;
                            $scope.q = '';
                            $scope.selectedStudent = undefined;
                            toastr.success(stu.nickName + ' is registered!');
                            showStudent(stu, false);
                            $scope.networkInProgress = false;
                        }
                    });
                }
            });
        }
    };

    let dispTimeout = undefined;
    let showStudent = function (student, changed) {
        if (dispTimeout !== undefined)
            clearTimeout(dispTimeout);
        if (fs.existsSync(photoPath + '/' + student.id + '.jpg')){
            $scope.pic = photoPath + '/' + student.id + '.jpg';
        }else {
            $scope.pic = 'http://wiki.bdtnrm.org.au/images/8/8d/Empty_profile.jpg';
            toastr.error('Photo not found, please go to Advanced -> Download Photos');
        }
        $scope.fn = student.firstName;
        $scope.ln = student.lastName;
        $scope.nn = student.nickName;
        if (!changed)
            $scope.$apply();
        dispTimeout = setTimeout(function () {
            console.log('its high noon');
            $scope.pic = placeHolderPic;
            $scope.fn = 'First Name';
            $scope.ln = 'Last Name';
            $scope.nn = 'Nickname';
            $scope.$apply();
        }, 5000);
    };

    let doReg = function (s, rfid, cnt) {
        if (cnt < 3) {
            syncManager.uploadRegister(s.id, rfid, function (ret) {
                if (!ret) {
                    doReg(s, rfid, cnt + 1);
                } else {
                    for (let i = 0; i < $scope.students.length; i++) {
                        if (s.id == $scope.students[i].id) {
                            $scope.students[i].rfid = rfid;
                            db.run("UPDATE `StudentInfo` SET `rfid` = ? WHERE `id` = ?", [rfid, s.id], function (err) {
                                if (err) console.error(err);
                                $scope.regRfid = undefined;
                                $scope.selectedStudent = undefined;
                                $scope.q = '';
                                toastr.success(s.nickName + ' is registered!');
                                showStudent(s, false);
                                $scope.networkInProgress = false;
                            });
                            break;
                        }
                    }
                }
            });
        } else {
            toastr.error(s.nickName + " is not registered due to network error! Please try again!",{timeOut:10000});
            $scope.networkInProgress = false;
        }
    };

});
app.controller('settingsCtrl', function ($scope, $window, LS) {
    $scope.showAddStudent = LS.get('show-add-student',true) == "true";
    $scope.showRmStudent = LS.get('show-rm-student',true) == "true";
    $scope.showRegStudent = LS.get('show-reg-student',true) == "true";
    $scope.hideRepeat = LS.get('hide-repeat',false) == "true";
    $scope.progressBar = LS.get('progress-bar',true) == "true";
    $scope.addStudentChange = function(){
        LS.set('show-add-student',$scope.showAddStudent);
    };
    $scope.rmStudentChange = function(){
        LS.set('show-rm-student',$scope.showRmStudent);
    };
    $scope.regStudentChange = function(){
        LS.set('show-reg-student',$scope.showRegStudent);
    };
    $scope.hideRepeatChange = function(){
        LS.set('hide-repeat',$scope.hideRepeat);
    };
    $scope.progressBarChange = function(){
        LS.set('progress-bar',$scope.progressBar);
    };
    $scope.dataPath = dataPath;
});