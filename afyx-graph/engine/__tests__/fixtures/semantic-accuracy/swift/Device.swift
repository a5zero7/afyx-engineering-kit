protocol DeviceController {
    func connect() -> Bool
}

class BluetoothDevice: DeviceController {
    func connect() -> Bool {
        return true
    }
}

class AppManager {
    func setup(device: BluetoothDevice) -> Bool {
        return device.connect()
    }
}

