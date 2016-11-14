const smartcard = require('smartcard');
const electron = require('electron');
const eapp = electron.remote.app;
const Devices = smartcard.Devices;
const devices = new Devices();
let currentDevices = [];
const sqlite3 = require('sqlite3');

const domain = "http://hn2.guardiantech.com.cn:10492/v2/";

var app = angular.module("studentCheck",['ngRoute','routeStyles'], function ($httpProvider) {
    $httpProvider.defaults.headers.post['Content-Type'] = 'application/x-www-form-urlencoded;charset=utf-8';
    var param = function (obj) {
        var query = '', name, value, fullSubName, subName, subValue, innerObj, i;

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
app.factory("session", function () {
    return {
        get: function (key) {
            return window.sessionStorage.getItem(key);
        },
        set: function (key,value) {
            window.sessionStorage.setItem(key,value);
        }
    };
});
app.factory('httpInterceptor', ['$q', '$injector','session', function ($q, $injector ,session) {
    var httpInterceptor = {
        'responseError': function (response) {
            return $q.reject(response);
        },
        'response': function (response) {
            return response;
        },
        'request': function (config) {
            if(session.get("token") !== undefined && session.get("token") != ""){
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
app.factory('syncManager', function ($http, $rootScope) {
    return{
        downloadStudentInfo: function (callback) {
            $http.get(domain + 'api/student/all').then(function (result) {
                $rootScope.db.serialize(function(){
                    $rootScope.db.run("BEGIN TRANSACTION");
                    var stmt = $rootScope.db.prepare("INSERT OR REPLACE INTO `StudentInfo` ('id','firstName','lastName','rfid','dorm') VALUES (?,?,?,?,?)");
                    for (var i = 0; i < result.data.students.length; i++){
                        var student = result.data.students[i];
                        stmt.run([student.studentId,student.firstName,student.lastName,student.rfid,student.dorm]);
                    }
                    stmt.finalize();
                    $rootScope.db.run("COMMIT");
                    callback(true);
                });
            }, function(error){
                alert("Download Students Error!");
                callback(false);
            });
        },
        downloadEvents: function(callback){
            $http.get(domain + '/api/event/list').then(function (result) {
                $rootScope.db.serialize(function(){
                    $rootScope.db.run("BEGIN TRANSACTION");
                    var stmt = $rootScope.db.prepare("INSERT OR REPLACE INTO `Events` ('eventId','eventName','status') VALUES (?,?,?)");
                    for (var i = 0; i < result.data.events.length; i++){
                        var event = result.data.events[i];
                        if(event.eventStatus != 2){
                            stmt.run([event.eventId,event.eventName,event.eventStatus]);
                        }
                    }
                    stmt.finalize();
                    $rootScope.db.run("COMMIT");
                    callback(true);
                });
            }, function(error){
                alert("Download Events Error!");
                callback(false);
            });
        },
        downloadEventStudents: function(eventId, callback){
            $http.get(domain + 'api/event/'+eventId+'/detail').then(function (result) {
                callback(result.data.students);
            }, function(error){
                alert("Download Student @ "+eventId+" Error!");
                callback(false);
            });
        },
        uploadAddStudent: function (id, checkin, checkout, eventId, callback) {
            $http.post(domain + 'api/event/'+ eventId +'/add',{data:JSON.stringify({add:[{id:id.toString(),checkin:checkin.toString(),checkout:checkout.toString()}]})}).then(function (suc) {
                callback(true);
            }, function (err) {
                callback(false);
            });
        },
        uploadRemoveStudent: function (id, eventId, callback) {
            $http.post(domain + 'api/event/'+ eventId +'/remove',{data:JSON.stringify({remove:[id.toString()]})}).then(function (suc) {
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
        .when("/login",{
            templateUrl: 'templates/login.ng',
            controller: 'loginCtrl',
            css: 'templates/login.css'
        })
        .when("/home",{
            templateUrl: 'templates/home.ng',
            css: 'templates/home.css',
            controller: 'homeCtrl'
        })
        .when("/event",{
            templateUrl: 'templates/event.ng',
            controller: 'eventCtrl'
        })
        .when("/checkin/:eventId",{
            templateUrl: 'templates/checkin.ng',
            controller: 'checkinCtrl'
        })
        .when("/advanced",{
            templateUrl: 'templates/advanced.ng',
            css:'templates/advanced.css',
            controller: 'advancedCtrl'
        })
        .otherwise({
            templateUrl: 'templates/index.ng',
            controller: 'indexCtrl'
        });
});

app.controller("navbarCtrl",function ($scope, $http, session, $location) {
    $scope.$watchCollection(
        function () {
            return [session.get("token")!=null, session.get("username")];
        },
        function (newVal, oldVal) {
            $scope.isLoggedIn = newVal[0];
            $scope.username = newVal[1];
        }
    );
    $scope.goBack = function(){
        /*window.history.back();*/
        var url = '';
        switch ('/'+$location.url().split('/')[1]){
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
        }
        if (url!=''){
            $location.url(url);
        }
    };
});
app.controller('indexCtrl',function ($scope, $http, session) {
    window.location.href="#/login";
});
app.controller('loginCtrl',function ($scope, $http, session) {
    $scope.isLoggingIn = false;
    $scope.login = function(){
        $scope.isLoggingIn = true;
        $http.post(domain+"api/auth",{username:$scope.username, password:calcMD5($scope.password)})
            .then(function (result) {
                session.set("token",result.data.token);
                session.set("username",$scope.username);
                    window.location.href="#/home";
            },
            function (failResult) {
                $scope.password = "";
                $scope.isLoggingIn = false;
                alert("Sign In Failed"+JSON.stringify(failResult.data));
            });
    }
});
app.controller('homeCtrl',function ($rootScope) {
    // schemaBuilder.createTable('StudentInfo')
    //     .addColumn('id', lf.Type.INTEGER)
    //     .addColumn('firstName', lf.Type.STRING)
    //     .addColumn('lastName',lf.Type.STRING)
    //     .addColumn('rfid',lf.Type.STRING)
    //     .addColumn('dorm',lf.Type.STRING)
    //     .addPrimaryKey(['id'])
    //     .addNullable(['firstName','lastName','rfid','dorm']);
    // schemaBuilder.createTable('StudentCheck')
    //     .addColumn('id', lf.Type.INTEGER)
    //     .addColumn('eventId', lf.Type.STRING)
    //     .addColumn('inTime',lf.Type.STRING)
    //     .addColumn('outTime',lf.Type.STRING)
    //     .addColumn('upload',lf.Type.INTEGER)
    //     .addPrimaryKey(['id','eventId'])
    //     .addNullable(['inTime','outTime','upload']);
    // schemaBuilder.createTable('StudentReg')
    //     .addColumn('id', lf.Type.INTEGER)
    //     .addColumn('rfid', lf.Type.STRING)
    //     .addPrimaryKey(['id'])
    //     .addNullable(['rfid']);
    // schemaBuilder.createTable('Events')
    //     .addColumn('eventId', lf.Type.INTEGER)
    //     .addColumn('eventName', lf.Type.STRING)
    //     .addColumn('eventStatus', lf.Type.INTEGER)
    //     .addPrimaryKey(['eventId'])
    //     .addNullable(['eventName','eventStatus']);
    // // var db;
    // // var item;
    // // schemaBuilder.connect()
    // //     .then(function(dbR){
    // //     db = dbR;
    // //     item = db.getSchema().table('StudentInfo');
    // //     var row = item.createRow({
    // //         'id': 12345,
    // //         'firstName': 'Tony',
    // //         'lastName': 'Liu',
    // //         'rfid': 'nil',
    // //         'dorm': 'ELE233'
    // //     });
    // //     return db.insertOrReplace().into(item).values([row]).exec();
    // // })
    // //     .then(function() {
    // //     return db.select().from(item).where(item.id.eq(12345)).exec();
    // // }).then(function(results) {
    // //     results.forEach(function(row) {
    // //         console.log(row['lastName'] + row['firstName']);
    // //     });
    // // });
    // schemaBuilder.connect().then(function (dbR) {
    //     $rootScope.db = dbR;
    // });
    $rootScope.db = new sqlite3.Database('AOFCheckDB.db', function (error) {
        if (error!=null) alert("Failed to initialize database! " + error);
        else {
            // console.log('DB init succeed');
            $rootScope.db.exec(
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
                " status    TEXT                           ) ",
            function(error){
                if (error!=null) alert("Failed to create table! " + error);
                // else console.log("Create table succeed");
            });
        }
    });
});
app.controller('eventCtrl',function ($scope, $http) {
    $scope.selected = undefined;
    $scope.events = [];
    $http.get(domain+"api/event/list").then(function (successReturn) {
        $scope.events = successReturn.data.events;
    });
    $scope.selectItem = function (item) {
        $scope.selected = item;
    };
    $scope.isActive = function(item) {
        return $scope.selected == item;
    };
    $scope.continueEvent = function () {
        if($scope.selected < 0){
            alert("Please select a event!");
        }else {
            // session.set('currentEvent',JSON.stringify($scope.events[$scope.selected]));
            console.log($scope.selected.eventId);
            window.location.href = "#/checkin/"+$scope.selected.eventId;
        }
    };
    $scope.activeFilter = function(event) {
        return event.eventStatus != 2;
    };
});
app.controller('checkinCtrl',function ($scope, $routeParams, session, syncManager, $rootScope) {
    $scope.students=[];
    var eventId = $routeParams.eventId;
    $rootScope.db.all("SELECT * FROM `StudentInfo`",function(err,rows){
        rows.forEach(function (row) {
            $scope.students.push({
                id:row.id,
                firstName:row.firstName,
                lastName:row.lastName,
                inTime:'',
                outTime:'',
                rfid:row.rfid,
                dorm:row.dorm
            });
        });
        syncManager.downloadEventStudents(eventId, function (ret) {
            if (ret != false) {
                for (var i = 0; i < ret.length; i++) {
                    for (var k = 0; k < $scope.students.length; k++) {
                        if ($scope.students[k].id === ret[i].studentId) {
                            $scope.students[k].inTime = ret[i].checkinTime;
                            $scope.students[k].outTime = ret[i].checkoutTime;
                            break;
                        }
                    }
                }
            }
        });
    });
    $scope.q = '';
    $scope.searchFilter = function(student){
        if ($scope.q == ''){
            return student.inTime != '' && student.outTime == '' && student.lastName.substring(0,$scope.q.length).toLowerCase() === $scope.q.toLowerCase();
        }else {
            return student.lastName.substring(0,$scope.q.length).toLowerCase() === $scope.q.toLowerCase();
        }
    };
    $scope.isCheckedIn = function (student) {
        return (student.inTime != '' && student.outTime == '')
    };
    $scope.getCheckinLen = function () {
        var n = 0;
        $scope.students.forEach(function (student) {
            if (student.inTime != '' && student.outTime == '') n++;
        });
        return n;
    };

    $scope.addStudentByName = function(stu){
        for (var i = 0; i < $scope.students.length; i++){
            if (stu.id == $scope.students[i].id){
                $scope.students[i].inTime = new Date().getTime();
                console.log(stu.firstName +" added @ " + $scope.students[i].inTime);
                var s = $scope.students[i];
                doUpload(s, 0);
                break;
            }
        }
    };

    var doUpload = function (s, cnt) {
        if (cnt < 5){
            syncManager.uploadAddStudent(s.id, s.inTime, s.outTime, eventId, function(ret){
                console.log("upload add succeed = "+ret);
                if (ret === false){doUpload(s, cnt++)}});
        }
    };

    $scope.deleteStudentByName = function(stu){
        for (var i = 0; i < $scope.students.length; i++){
            if (stu.id == $scope.students[i].id){
                $scope.students[i].inTime = '';
                console.log(stu.firstName +" removed");
                var s = $scope.students[i];
                doDownload(s, 0);
                break;
            }
        }
    };

    var doDownload = function (s, cnt) {
        if (cnt < 5){
            syncManager.uploadRemoveStudent(s.id, eventId, function(ret){
                console.log("upload remove succeed = "+ret);
                if (ret === false){doDownload(s, cnt++)}});
        }
    };

});
app.controller('advancedCtrl',function($scope,syncManager){
    $scope.downloadStudentInfo = function () {
        $scope.downloadStudentInfoInProgress = true;
        syncManager.downloadStudentInfo(function(ret){$scope.downloadStudentInfoInProgress = false;});
    };
    $scope.downloadEvents = function(){
        $scope.downloadEventsInProgress = true;
        syncManager.downloadEvents(function(ret){$scope.downloadEventsInProgress = false;});
    };
    $scope.downloadStudentInfoInProgress = false;
    $scope.downloadEventsInProgress = false;
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