import Foundation
import Combine

struct Biometrics: Codable, Sendable {
    var steps: Int
    var sleep: Double
    var hrv: Int
    var rhr: Int
    var weight: Double
    var wakeTime: String
    var sleepTime: String?
}

struct Habits: Codable, Sendable {
    var wakeUpOnTime: Bool
    var gymWorkout: Bool
    var journaling: Bool
}

struct HabitDay: Codable, Identifiable, Sendable {
    var id: String { date }
    var date: String
    var wakeUpOnTime: Bool
    var gymWorkout: Bool
    var journaling: Bool
}

struct WorkoutSet: Codable, Identifiable, Sendable {
    var id = UUID()
    var date: String
    var exercise: String
    var setNumber: Int
    var weight: Double
    var reps: Int
    var duration: Double
    var distance: Double
    
    enum CodingKeys: String, CodingKey {
        case date, exercise, setNumber, weight, reps, duration, distance
    }
}

struct CostcoItem: Codable, Identifiable, Sendable {
    var id: String { "\(trip)_\(name)" }
    var trip: String
    var department: String
    var name: String
    var size: String
    var assignment: String
}

struct MissionControlItem: Codable, Identifiable, Sendable {
    var id: String
    var status: Bool
    var scheduled: Bool
    var type: String
    var calendar: String
    var date: String
    var time: String
    var duration: Int
    var location: String
    var notes: String
    var eventId: String
    var timeblockId: String
    var itemName: String
    
    enum CodingKeys: String, CodingKey {
        case id, status, scheduled, type, calendar, date, time, duration, location, notes, eventId, timeblockId, itemName
    }
}

struct DashboardData: Codable, Sendable {
    var date: String
    var biometrics: Biometrics
    var habits: Habits
    var habitHistory: [HabitDay]
    var recentWorkouts: [WorkoutSet]
    var costcoItems: [CostcoItem]
    var missionControlItems: [MissionControlItem]?
}

class NetworkManager: ObservableObject {
    @Published var dateStr: String = "Loading..."
    @Published var biometrics: Biometrics = Biometrics(steps: 0, sleep: 0.0, hrv: 0, rhr: 0, weight: 170.0, wakeTime: "No data", sleepTime: "No data")
    @Published var habits: Habits = Habits(wakeUpOnTime: false, gymWorkout: false, journaling: false)
    @Published var habitHistory: [HabitDay] = []
    @Published var recentWorkouts: [WorkoutSet] = []
    @Published var costcoItems: [CostcoItem] = []
    @Published var missionControlItems: [MissionControlItem] = []
    @Published var isLoading: Bool = false
    
    // Consolidated Apps Script Web App Endpoint URL
    var apiURLString = "https://script.google.com/macros/s/AKfycbzlQKBy3jyOv3SqhV-iqwtCQBoP7Ry-uAhTpbTJE0FhU0mZKG-KX0UlR-BB2VrVYrx5Xg/exec"
    
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
            
            // Dispatch specifically to MainActor via structured Swift concurrency Task
            Task { @MainActor in
                self.updateDashboardData(with: data)
            }
        }.resume()
    }
    
    @MainActor
    private func updateDashboardData(with data: Data) {
        do {
            let decoder = JSONDecoder()
            let decodedData = try decoder.decode(DashboardData.self, from: data)
            
            self.dateStr = decodedData.date
            self.biometrics = decodedData.biometrics
            self.habits = decodedData.habits
            self.habitHistory = decodedData.habitHistory
            self.recentWorkouts = decodedData.recentWorkouts
            self.costcoItems = decodedData.costcoItems
            self.missionControlItems = decodedData.missionControlItems ?? []
        } catch {
            print("JSON Decoding error: \(error)")
        }
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
            "action": "toggle_habit",
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
                Task { @MainActor in
                    self.fetchData()
                }
                return
            }
            
            print("Habit \(habitName) successfully updated on sheet to \(completed)")
            
            // Re-fetch to sync status on MainActor
            Task { @MainActor in
                self.fetchData()
            }
        }.resume()
    }
    
    func logWorkoutSet(exercise: String, weight: Double, reps: Int, duration: Double, distance: Double, splitDay: String, completion: @escaping (Bool) -> Void) {
        guard let url = URL(string: apiURLString) else {
            completion(false)
            return
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let payload: [String: Any] = [
            "action": "log_workout",
            "exercise": exercise,
            "weight": weight,
            "reps": reps,
            "duration": duration,
            "distance": distance,
            "splitDay": splitDay
        ]
        
        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: payload, options: [])
        } catch {
            print("Payload serialization error: \(error)")
            completion(false)
            return
        }
        
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                print("Error logging workout set: \(error.localizedDescription)")
                completion(false)
                return
            }
            
            print("Workout set logged successfully: \(exercise)")
            
            // Re-fetch to sync status on MainActor
            Task { @MainActor in
                self.fetchData()
                completion(true)
            }
        }.resume()
    }
    
    func importHevyCSV(csvText: String, completion: @escaping (Bool, Int, String) -> Void) {
        guard let url = URL(string: apiURLString) else {
            completion(false, 0, "Invalid API URL string")
            return
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let payload: [String: Any] = [
            "action": "import_hevy_csv",
            "csvText": csvText
        ]
        
        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: payload, options: [])
        } catch {
            print("Payload serialization error: \(error)")
            completion(false, 0, "Payload serialization error: \(error.localizedDescription)")
            return
        }
        
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                print("Error importing Hevy CSV: \(error.localizedDescription)")
                completion(false, 0, error.localizedDescription)
                return
            }
            
            guard let data = data else {
                completion(false, 0, "No data received from server")
                return
            }
            
            do {
                if let json = try JSONSerialization.jsonObject(with: data, options: []) as? [String: Any] {
                    if let success = json["success"] as? Bool, success {
                        let count = json["importedSets"] as? Int ?? 0
                        // Re-fetch to sync status on MainActor
                        Task { @MainActor in
                            self.fetchData()
                        }
                        completion(true, count, "")
                        return
                    } else if let errorMsg = json["error"] as? String {
                        completion(false, 0, errorMsg)
                        return
                    }
                }
                
                // Fallback if success key is missing or false without explicit error key
                if let responseStr = String(data: data, encoding: .utf8) {
                    completion(false, 0, "Server response: \(responseStr)")
                } else {
                    completion(false, 0, "Server returned invalid format")
                }
            } catch {
                print("JSON parsing error: \(error)")
                if let responseStr = String(data: data, encoding: .utf8) {
                    completion(false, 0, "Parsing error: \(error.localizedDescription). Raw: \(responseStr)")
                } else {
                    completion(false, 0, "Parsing error: \(error.localizedDescription)")
                }
            }
        }.resume()
    }
    
    func logMissionItem(itemName: String, type: String, calendar: String, date: String, time: String, duration: Int, location: String, notes: String, completion: @escaping (Bool) -> Void) {
        guard let url = URL(string: apiURLString) else {
            completion(false)
            return
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let payload: [String: Any] = [
            "action": "log_mission_item",
            "itemName": itemName,
            "type": type,
            "calendar": calendar,
            "date": date,
            "time": time,
            "duration": duration,
            "location": location,
            "notes": notes
        ]
        
        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: payload, options: [])
        } catch {
            print("Payload serialization error: \(error)")
            completion(false)
            return
        }
        
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                print("Error logging mission item: \(error.localizedDescription)")
                completion(false)
                return
            }
            
            print("Mission item logged successfully: \(itemName)")
            
            Task { @MainActor in
                self.fetchData()
                completion(true)
            }
        }.resume()
    }
    
    func toggleMissionItem(eventId: String, completed: Bool) {
        DispatchQueue.main.async {
            if let idx = self.missionControlItems.firstIndex(where: { $0.id == eventId }) {
                self.missionControlItems[idx].status = completed
            }
        }
        
        guard let url = URL(string: apiURLString) else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let payload: [String: Any] = [
            "action": "toggle_mission_item",
            "eventId": eventId,
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
                print("Error toggling mission item: \(error.localizedDescription)")
                Task { @MainActor in
                    self.fetchData()
                }
                return
            }
            
            print("Mission item \(eventId) toggled to \(completed)")
            
            Task { @MainActor in
                self.fetchData()
            }
        }.resume()
    }
    
    func deleteMissionItem(eventId: String) {
        DispatchQueue.main.async {
            self.missionControlItems.removeAll(where: { $0.id == eventId })
        }
        
        guard let url = URL(string: apiURLString) else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let payload: [String: Any] = [
            "action": "delete_mission_item",
            "eventId": eventId
        ]
        
        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: payload, options: [])
        } catch {
            print("Payload serialization error: \(error)")
            return
        }
        
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                print("Error deleting mission item: \(error.localizedDescription)")
                Task { @MainActor in
                    self.fetchData()
                }
                return
            }
            
            print("Mission item \(eventId) deleted")
            
            Task { @MainActor in
                self.fetchData()
            }
        }.resume()
    }
}
