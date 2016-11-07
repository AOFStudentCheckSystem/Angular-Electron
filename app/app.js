const smartcard = require('smartcard');
const electron = require('electron');
const eapp = electron.remote.app;
const Devices = smartcard.Devices;
const devices = new Devices();

const domain = "http://localhost:8080";

var app = angular.module("studentCheck",[]);

app.controller("cardDisplayCtrl",function ($scope) {
    $scope.card = "No Reader";

    // window.localStorage.setItem("hello","test");
    devices.on('device-activated', function (event) {
        $scope.card="No Card";
        $scope.$apply();
        const currentDevices = event.devices;
        let device = event.device;
        device.on('card-inserted', function (event) {
            let card = event.card;
            $scope.card = card.getAtr();
            $scope.$apply();

        });
        device.on('card-removed', function (event) {
            $scope.card = "No Card";
            $scope.$apply();

        });
    });
    devices.on('device-deactivated', function (event) {
        $scope.card="No Reader";
        $scope.$apply();

    });
});