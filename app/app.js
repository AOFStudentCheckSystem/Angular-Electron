const smartcard = require('smartcard');
const electron = require('electron');
const fs = require('fs');
const sqlite3 = require('sqlite3');
const eapp = electron.remote.app;
const Devices = smartcard.Devices;
const devices = new Devices();
let currentDevices = [];
let db;
const photoPath = eapp.getPath('appData') + '/student-check-electron-angular/pics';
///Users/liupeiqi/Library/Application Support/student-check-electron-angular/pics


const domain = "http://hn2.guardiantech.com.cn:10492/v2/";

let app = angular.module("studentCheck", ['ngRoute', 'routeStyles'], function ($httpProvider) {
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

    devices.on('device-activated', event => {
        console.log("Reader added :" + event.device);
        currentDevices = event.devices;
    });
    devices.on('device-deactivated', event => {
        console.log("Reader removed :" + event.device);
        currentDevices = event.devices;
    });
});
app.factory("session", function () {
    return {
        get: function (key) {
            return window.sessionStorage.getItem(key);
        },
        set: function (key, value) {
            window.sessionStorage.setItem(key, value);
        }
    };
});
app.factory('httpInterceptor', ['$q', '$injector', 'session', function ($q, $injector, session) {
    let httpInterceptor = {
        'responseError': function (response) {
            return $q.reject(response);
        },
        'response': function (response) {
            return response;
        },
        'request': function (config) {
            if (session.get("token") !== undefined && session.get("token") != "") {
                config.headers['Authorization'] = "Bearer " + session.get("token");
            }
            return config;
        },
        'requestError': function (config) {
            return $q.reject(config);
        }
    };
    return httpInterceptor;
}]);
//Network & DB
app.factory('syncManager', function ($http, $rootScope) {
    return {
        downloadStudentInfo: function (callback) {
            $http.get(domain + 'api/student/all').then(function (result) {
                db.serialize(function () {
                    db.run("BEGIN TRANSACTION");
                    // db.run("DELETE FROM `StudentInfo`");
                    let stmt = db.prepare("INSERT OR REPLACE INTO `StudentInfo` ('id','firstName','lastName','rfid','dorm') VALUES (?,?,?,?,?)");
                    for (let i = 0; i < result.data.students.length; i++) {
                        let student = result.data.students[i];
                        stmt.run([student.studentId, student.firstName, student.lastName, student.rfid, student.dorm]);
                    }
                    stmt.finalize();
                    db.run("COMMIT");
                    callback(true);
                });
            }, function (error) {
                alert("Download Students Error!");
                callback(false);
            });
        },
        downloadEvents: function (callback) {
            $http.get(domain + '/api/event/list').then(function (result) {
                db.serialize(function () {
                    db.run("BEGIN TRANSACTION");
                    // db.run("DELETE FROM `Events`");
                    let stmt = db.prepare("INSERT OR REPLACE INTO `Events` ('eventId','eventName','eventTime','status') VALUES (?,?,?,?)");
                    for (let i = 0; i < result.data.events.length; i++) {
                        let event = result.data.events[i];
                        if (event.eventStatus != 2) {
                            stmt.run([event.eventId, event.eventName, event.eventTime, event.eventStatus]);
                        }
                    }
                    stmt.finalize();
                    db.run("COMMIT");
                    callback(true);
                });
            }, function (error) {
                alert("Download Events Error!");
                callback(false);
            });
        },
        readEvents: function (callback) {
            // console.log("calledReadEvents");
            db.all("SELECT * FROM `Events` WHERE `status` <> 2", [], function (err, rows) {
                if (err == null) {
                    let events = [];
                    rows.forEach(function (row) {
                        events.push(
                            {
                                eventId: row.eventId,
                                eventName: row.eventName,
                                eventTime: row.eventTime,
                                eventStatus: row.status
                            }
                        );
                    });
                    // console.log("length:" + events.length);
                    callback(events);
                } else {
                    console.warn("error:" + err);
                }
            });
        },
        downloadEventStudents: function (eventId, callback) {
            $http.get(domain + 'api/event/' + eventId + '/detail').then(function (result) {
                callback(result.data.students);
            }, function (error) {
                alert("Download Student @ " + eventId + " Error!");
                callback(null);
            });
        },
        downloadPics: function (callback){
            console.log(photoPath);
            if (!fs.existsSync(photoPath)){
                console.log('DNE, attempt to mkdir');
                fs.mkdirSync(photoPath);
            }else {
                console.log('folder already exist');
            }
                db.each("SELECT * FROM `StudentInfo`",[],function (err, row) {
                        if (!fs.existsSync(photoPath + '/' + row.id + '.jpg')){
                            $http.get(domain + '/api/student/'+ row.id +'/image').then(function (result) {

                                fs.writeFile(photoPath + '/' + row.id + '.jpg', result, (err)=>{
                                    if (err){
                                        console.warn('write file error @' + row.id + ' :' + err);
                                    }else {
                                        console.log('write file succeed @' + row.id);
                                    }
                                });
                                callback(true,null);
                            }, function (error) {
                                console.log('http error occur @' + row.id + ' :' + error);
                                callback(true,null);
                            });
                        }else {
                            console.log('AE @' + row.id);
                            callback(true,null);
                        }
                    },
                    function (err, rowN) {
                        callback(false,rowN);
                    });
        },
        uploadAddStudent: function (id, checkin, checkout, eventId, callback) {
            $http.post(domain + 'api/event/' + eventId + '/add', {
                data: JSON.stringify({
                    add: [{
                        id: id.toString(),
                        checkin: checkin.toString(),
                        checkout: checkout.toString()
                    }]
                })
            }).then(function (suc) {
                callback(true);
            }, function (err) {
                callback(false);
            });
        },
        uploadRemoveStudent: function (id, eventId, callback) {
            $http.post(domain + 'api/event/' + eventId + '/remove', {data: JSON.stringify({remove: [id.toString()]})}).then(function (suc) {
                callback(true);
            }, function (err) {
                callback(false);
            });
        },
        uploadAddEvent: function (eventName, callback) {
            $http.post(domain + 'api/event/add', {eventName: eventName}).then(function (suc) {
                callback(suc);
            }, function (err) {
                callback(null);
            });
        },
        uploadCompleteEvent: function (eventId, callback) {
            $http.post(domain + 'api/event/' + eventId + '/complete', {}).then(function (suc) {
                db.run("UPDATE `Events` SET `status` = ? WHERE `eventId` = ?", [2, eventId]);
                callback(true);
            }, function (err) {
                callback(false);
            });
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
            // css: 'templates/login.css'
        })
        .when("/home", {
            templateUrl: 'templates/home.ng',
            // css: 'templates/home.css',
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
            // css: 'templates/advanced.css',
            controller: 'advancedCtrl'
        })
        .when("/events", {
            templateUrl: 'templates/events.ng',
            controller: 'eventsCtrl'
        })
        .otherwise({
            templateUrl: 'templates/index.ng',
            controller: 'indexCtrl'
        });
});

app.controller("navbarCtrl", function ($scope, $http, session, $location) {
    $scope.$watchCollection(
        function () {
            return [session.get("token") != null, session.get("username")];
        },
        function (newVal, oldVal) {
            $scope.isLoggedIn = newVal[0];
            $scope.username = newVal[1];
        }
    );
    $scope.goBack = function () {
        /*window.history.back();*/
        let url = '';
        switch ('/' + $location.url().split('/')[1]) {
            case '/home':
                url = '/login';
                break;
            case '/event':
                url = '/home';
                break;
            case '/checkin':
                url = '/event';
                break;
            case '/advanced':
                url = '/home';
                break;
            case '/events':
                url = '/home';
                break;
        }
        if (url != '') {
            $location.url(url);
        }
    };
});
app.controller('indexCtrl', function () {
    window.location.href = "#/login";
});
app.controller('loginCtrl', function ($scope, $http, session) {
    $scope.isLoggingIn = false;
    $scope.login = function () {
        $scope.isLoggingIn = true;
        $http.post(domain + "api/auth", {username: $scope.username, password: calcMD5($scope.password)})
            .then(function (result) {
                    session.set("token", result.data.token);
                    session.set("username", $scope.username);
                    window.location.href = "#/home";
                },
                function (failResult) {
                    $scope.password = "";
                    $scope.isLoggingIn = false;
                    alert("Sign In Failed" + JSON.stringify(failResult.data));
                });
    }
});
app.controller('homeCtrl', function () {
    db = new sqlite3.Database('AOFCheckDB.db', function (error) {
        if (error != null) alert("Failed to initialize database! " + error);
        else {
            // console.log('DB init succeed');
            db.exec(
                "CREATE TABLE if not exists StudentInfo      " +
                "(id     TEXT PRIMARY KEY UNIQUE NOT NULL," +
                " firstName TEXT                            ," +
                " lastName  TEXT                            ," +
                " rfid      TEXT                            ," +
                " dorm      TEXT                           );" +
                "CREATE TABLE if not exists StudentCheck     " +
                "(id     TEXT                    NOT NULL," +
                " eventId   TEXT                    NOT NULL," +
                " inTime    TEXT                            ," +
                " outTime   TEXT                            ," +
                " upload  TEXT                              ," +
                " PRIMARY KEY (id, eventId)             );" +
                "CREATE TABLE if not exists StudentReg       " +
                "(id     TEXT PRIMARY KEY UNIQUE NOT NULL," +
                " rfid      TEXT                           );" +
                "CREATE TABLE if not exists Events           " +
                "(eventId   TEXT PRIMARY KEY UNIQUE NOT NULL," +
                " eventName TEXT                            ," +
                " eventTime TEXT                            ," +
                " status    TEXT                           ) ",
                function (error) {
                    if (error != null) alert("Failed to create table! " + error);
                    // else console.log("Create table succeed");
                });
        }
    });
});
app.controller('eventCtrl', function ($scope, $http) {
    $scope.selected = undefined;
    $scope.events = [];

    $http.get(domain + "api/event/list").then(function (successReturn) {
        $scope.events = successReturn.data.events;
    });
    $scope.selectItem = function (item) {
        $scope.selected = item;
    };
    $scope.isActive = function (item) {
        return $scope.selected == item;
    };
    $scope.continueEvent = function () {
        if ($scope.selected < 0) {
            alert("Please select a event!");
        } else {
            // session.set('currentEvent',JSON.stringify($scope.events[$scope.selected]));
            console.log($scope.selected.eventId);
            window.location.href = "#/checkin/" + $scope.selected.eventId;
        }
    };
    $scope.activeFilter = function (event) {
        return event.eventStatus != 2;
    };
});
app.controller('checkinCtrl', function ($scope, $routeParams, session, syncManager) {
    $scope.students = [];
    let eventId = $routeParams.eventId;
    db.all("SELECT * FROM `StudentInfo`", function (err, rows) {
        rows.forEach(function (row) {
            $scope.students.push({
                id: row.id,
                firstName: row.firstName,
                lastName: row.lastName,
                inTime: '',
                outTime: '',
                rfid: row.rfid,
                dorm: row.dorm
            });
        });
        syncManager.downloadEventStudents(eventId, function (ret) {
            // console.log(JSON.stringify(ret));
            if (ret != null) {
                for (let i = 0; i < ret.length; i++) {
                    // console.log($scope.students.length);
                    for (let k = 0; k < $scope.students.length; k++) {
                        // console.log("i="+i+" k="+k);
                        if ($scope.students[k].id === ret[i].studentId) {
                            $scope.students[k].inTime = ret[i].checkinTime;
                            $scope.students[k].outTime = ret[i].checkoutTime == null ? '' : ret[i].checkoutTime;
                            console.log("id:" + $scope.students[k].id + " in:" + $scope.students[k].inTime + " out:" + $scope.students[k].outTime);
                            break;
                        }
                    }
                }
            }
        });
    });
    $scope.q = '';
    $scope.searchFilter = function (student) {
        if ($scope.q == '') {
            return student.inTime != '' && student.outTime == '' && student.lastName.substring(0, $scope.q.length).toLowerCase() === $scope.q.toLowerCase();
        } else {
            return student.lastName.substring(0, $scope.q.length).toLowerCase() === $scope.q.toLowerCase();
        }
    };
    $scope.isCheckedIn = function (student) {
        return (student.inTime != '' && student.outTime == '')
    };
    $scope.getCheckinLen = function () {
        let n = 0;
        $scope.students.forEach(function (student) {
            if (student.inTime != '' && student.outTime == '') n++;
        });
        return n;
    };

    $scope.checkinStudent = function (stu) {
        for (let i = 0; i < $scope.students.length; i++) {
            if (stu.id == $scope.students[i].id && $scope.students[i].inTime == '') {
                doUpload($scope.students[i], 0, new Date().getTime());
                break;
            }
        }
    };
    let doUpload = function (s, cnt, inTime) {
        if (cnt < 3) {
            syncManager.uploadAddStudent(s.id, inTime, s.outTime, eventId, function (ret) {
                console.log("upload add succeed = " + ret + " cnt = " + cnt + " inTime = " + inTime);
                if (ret === false) {
                    doUpload(s, cnt + 1, inTime);
                } else {
                    for (let i = 0; i < $scope.students.length; i++) {
                        if (s.id == $scope.students[i].id) {
                            $scope.students[i].inTime = inTime;
                            console.log($scope.students[i].firstName + " added @ " + $scope.students[i].inTime);
                            break;
                        }
                    }
                }
            });
        }
    };

    $scope.deleteStudent = function (stu) {
        for (let i = 0; i < $scope.students.length; i++) {
            if (stu.id == $scope.students[i].id) {
                $scope.students[i].inTime = '';
                console.log(stu.firstName + " removed");
                doDownload($scope.students[i], 0);
                break;
            }
        }
    };
    let doDownload = function (s, cnt) {
        if (cnt < 3) {
            syncManager.uploadRemoveStudent(s.id, eventId, function (ret) {
                console.log("upload remove succeed = " + ret + "cnt = " + cnt);
                if (ret === false) {
                    doDownload(s, cnt + 1);
                } else {
                    for (let i = 0; i < $scope.students.length; i++) {
                        if (s.id == $scope.students[i].id) {
                            $scope.students[i].inTime = '';
                            break;
                        }
                    }
                }
            });
        }
    };

    let cardReadLock = false;
    currentDevices.forEach(function (device) {
        device.on('card-inserted', event => {
            if (!cardReadLock){
                cardReadLock = true;
                let card = event.card;
                console.log(`Card '${card.getAtr()}' inserted into '${event.device}'`);
                //alert(event.card.getAtr());
                db.get('SELECT * FROM `StudentInfo` WHERE `rfid` = ? COLLATE NOCASE', [card.getAtr().toUpperCase()], function (err, row) {
                    if (err == null) {
                        // console.log("find it");
                        $scope.checkinStudent({
                            id: row.id,
                            firstName: row.firstName,
                            lastName: row.lastName,
                            inTime: row.inTime,
                            outTime: row.outTime,
                            rfid: row.rfid,
                            dorm: row.dorm
                        });
                    }else {
                        console.warn(err);
                    }
                });
            }
        });
        device.on('card-removed', event => {
                cardReadLock = false;
        });
    });

});
app.controller('advancedCtrl', function ($scope, syncManager) {
    $scope.downloadStudentInfo = function () {
        $scope.downloadStudentInfoInProgress = true;
        syncManager.downloadStudentInfo(function (ret) {
            $scope.downloadStudentInfoInProgress = false;
        });
    };
    $scope.downloadEvents = function () {
        $scope.downloadEventsInProgress = true;
        syncManager.downloadEvents(function (ret) {
            $scope.downloadEventsInProgress = false;
        });
    };
    $scope.downloadPics = function () {
        $scope.value = 0;
        $scope.downloadPicsInProgress = true;
        syncManager.downloadPics(function (cur, max) {
            if (max != null){$scope.maxv = max}
            if (cur) ++$scope.value;
            if ($scope.value >= $scope.maxv){
                $scope.downloadPicsInProgress = false;
            }
        })
    };
    $scope.value = 0;
    $scope.maxv = 100;
    $scope.downloadStudentInfoInProgress = false;
    $scope.downloadEventsInProgress = false;
    $scope.downloadPicsInProgress = false;
});
app.controller('eventsCtrl', function ($scope, $http, syncManager) {
    $scope.selected = undefined;
    $scope.events = [];
    $scope.eventName = '';

    let updateEvents = function () {
        syncManager.downloadEvents(function (ret1) {
            syncManager.readEvents(function (ret2) {
                $scope.events = ret2;
                $scope.$apply();
            });
        });
    };
    // $http.get(domain + "api/event/list").then(function (successReturn) {
    //     $scope.events = successReturn.data.events;
    // });
    updateEvents();

    $scope.selectItem = function (item) {
        $scope.selected = item;
    };
    $scope.isActive = function (item) {
        return $scope.selected == item;
    };
    $scope.activeFilter = function (event) {
        return event.eventStatus != 2;
    };
    $scope.addEvent = function () {
        let n = $scope.eventName;
        // console.log("start");
        syncManager.uploadAddEvent(n, function (ret) {
            if (ret !== null) {
                updateEvents();
            }
        });
    };
    $scope.completeEvent = function () {
        syncManager.uploadCompleteEvent($scope.selected.eventId, function (ret) {
            syncManager.readEvents(function (ret2) {
                $scope.events = ret2;
                $scope.$apply();
            });
        });
    }

});
// app.controller("cardDisplayCtrl",function ($scope) {
//     $scope.card = "No Reader";
//     $scope.card1 = "NN";
//     $scope.onRegister = function () {
//         alert('a');
//         console.log(currentDevices);
//         if (currentDevices.length > 0){
//             currentDevices.forEach(function (elem) {
//                 elem.on('card-inserted', function (event) {
//                     let card = event.card;
//                     $scope.card1 = card.getAtr();
//                     $scope.$apply();
//                 });
//             })
//         }
//         devices.on('device-activated', function (event) {
//             $scope.card1="No Card";
//             $scope.$apply();
//             currentDevices = event.devices;
//             let device = event.device;
//             device.on('card-inserted', function (event) {
//                 let card = event.card;
//                 $scope.card = card.getAtr();
//                 $scope.$apply();
//
//             });
//             device.on('card-removed', function (event) {
//                 $scope.card = "No Card";
//                 $scope.$apply();
//
//             });
//         });
//     };
//
//
//     // window.localStorage.setItem("hello","test");
//     devices.on('device-activated', function (event) {
//         $scope.card="No Card";
//         $scope.$apply();
//         currentDevices = event.devices;
//         let device = event.device;
//         device.on('card-inserted', function (event) {
//             let card = event.card;
//             $scope.card = card.getAtr();
//             $scope.$apply();
//
//         });
//         device.on('card-removed', function (event) {
//             $scope.card = "No Card";
//             $scope.$apply();
//
//         });
//     });
//     devices.on('device-deactivated', function (event) {
//         $scope.card="No Reader";
//         $scope.$apply();
//     });
//
//
// });