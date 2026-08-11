import Foundation
import CoreLocation
import Combine

class LocationManager: NSObject, ObservableObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    @Published var location: CLLocation?
    
    // Use your Apps Script Web App URL here
    let apiURLString = "https://script.google.com/macros/s/AKfycbzlQKBy3jyOv3SqhV-iqwtCQBoP7Ry-uAhTpbTJE0FhU0mZKG-KX0UlR-BB2VrVYrx5Xg/exec"
    
    override init() {
        super.init()
        manager.delegate = self
        // Significant location changes use very little battery and wake the app in the background
        manager.allowsBackgroundLocationUpdates = true
        manager.pausesLocationUpdatesAutomatically = false
        manager.desiredAccuracy = kCLLocationAccuracyKilometer
    }
    
    func requestPermissions() {
        manager.requestAlwaysAuthorization()
    }
    
    func startMonitoring() {
        manager.startMonitoringSignificantLocationChanges()
    }
    
    func stopMonitoring() {
        manager.stopMonitoringSignificantLocationChanges()
    }
    
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let latestLocation = locations.last else { return }
        self.location = latestLocation
        
        // Reverse geocode to get a readable location name
        let geocoder = CLGeocoder()
        geocoder.reverseGeocodeLocation(latestLocation) { [weak self] placemarks, error in
            var locationName = "Unknown Location"
            if let placemark = placemarks?.first {
                locationName = [placemark.name, placemark.locality, placemark.administrativeArea]
                    .compactMap { $0 }
                    .joined(separator: ", ")
            }
            
            self?.logLocationToBackend(lat: latestLocation.coordinate.latitude, lng: latestLocation.coordinate.longitude, locationName: locationName)
        }
    }
    
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        print("Location update failed: \(error.localizedDescription)")
    }
    
    private func logLocationToBackend(lat: Double, lng: Double, locationName: String) {
        guard let url = URL(string: apiURLString) else { return }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let payload: [String: Any] = [
            "action": "log_location",
            "latitude": lat,
            "longitude": lng,
            "locationName": locationName
        ]
        
        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: payload, options: [])
        } catch {
            print("Payload serialization error: \(error)")
            return
        }
        
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                print("Error logging location: \(error.localizedDescription)")
                return
            }
            print("Successfully logged location to backend: \(locationName)")
        }.resume()
    }
}
