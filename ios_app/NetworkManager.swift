import Foundation
import Combine

struct Biometrics: Codable {
    var steps: Int
    var sleep: Double
    var hrv: Int
    var rhr: Int
    var weight: Double
    var wakeTime: String
}

struct Habits: Codable {
    var wakeUpOnTime: Bool
    var gymWorkout: Bool
    var journaling: Bool
    
    enum CodingKeys: String, CodingKey {
        case wakeUpOnTime
        case gymWorkout
        case journaling
    }
}

struct DashboardData: Codable {
    var date: String
    var biometrics: Biometrics
    var habits: Habits
}

class NetworkManager: ObservableObject {
    @Published var dateStr: String = "Loading..."
    @Published var biometrics: Biometrics = Biometrics(steps: 0, sleep: 0.0, hrv: 0, rhr: 0, weight: 170.0, wakeTime: "No data")
    @Published var habits: Habits = Habits(wakeUpOnTime: false, gymWorkout: false, journaling: false)
    @Published var isLoading: Bool = false
    
    // REPLACE THIS URL WITH YOUR DEPLOYED GOOGLE APPS SCRIPT WEB APP URL
    var apiURLString = "https://script.google.com/macros/s/REPLACE_WITH_YOUR_WEB_APP_ID/exec"
    
    func fetchData() {
        guard let url = URL(string: apiURLString) else {
            print("Invalid URL")
            return
        }
        
        DispatchQueue.main.async {
            self.isLoading = true
        }
        
        URLSession.shared.dataTask(with: url) { data, response, error in
            DispatchQueue.main.async {
                self.isLoading = false
            }
            
            if let error = error {
                print("Error fetching data: \(error.localizedDescription)")
                return
            }
            
            guard let data = data else {
                print("No data received")
                return
            }
            
            do {
                let decoder = JSONDecoder()
                let decodedData = try decoder.decode(DashboardData.self, from: data)
                
                DispatchQueue.main.async {
                    self.dateStr = decodedData.date
                    self.biometrics = decodedData.biometrics
                    self.habits = decodedData.habits
                }
            } catch {
                print("JSON Decoding error: \(error)")
            }
        }.resume()
    }
    
    func toggleHabit(habitName: String, completed: Bool) {
        // Optimistic local UI update for snappy feedback
        DispatchQueue.main.async {
            switch habitName {
            case "Wake Up On Time":
                self.habits.wakeUpOnTime = completed
            case "Gym Workout":
                self.habits.gymWorkout = completed
            case "Journaling":
                self.habits.journaling = completed
            default:
                break
            }
        }
        
        guard let url = URL(string: apiURLString) else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let payload: [String: Any] = [
            "habit": habitName,
            "completed": completed
        ]
        
        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: payload, options: [])
        } catch {
            print("Payload serialization error: \(error)")
            return
        }
        
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                print("Error updating habit: \(error.localizedDescription)")
                // Revert on failure
                self.fetchData()
                return
            }
            
            print("Habit \(habitName) successfully updated on sheet to \(completed)")
            
            // Re-fetch to confirm and sync state
            self.fetchData()
        }.resume()
    }
}
