import Foundation
import Combine

struct Biometrics: Codable, Sendable {
    var steps: Int
    var sleep: Double
    var hrv: Int
    var rhr: Int
    var weight: Double
    var wakeTime: String
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

struct DashboardData: Codable, Sendable {
    var date: String
    var biometrics: Biometrics
    var habits: Habits
    var habitHistory: [HabitDay]
    var recentWorkouts: [WorkoutSet]
    var costcoItems: [CostcoItem]
}

class NetworkManager: ObservableObject {
    @Published var dateStr: String = "Loading..."
    @Published var biometrics: Biometrics = Biometrics(steps: 0, sleep: 0.0, hrv: 0, rhr: 0, weight: 170.0, wakeTime: "No data")
    @Published var habits: Habits = Habits(wakeUpOnTime: false, gymWorkout: false, journaling: false)
    @Published var habitHistory: [HabitDay] = []
    @Published var recentWorkouts: [WorkoutSet] = []
    @Published var costcoItems: [CostcoItem] = []
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
            
            // Perform decoding inside the main queue to satisfy @MainActor isolation rules in Swift 6
            DispatchQueue.main.async {
                do {
                    let decoder = JSONDecoder()
                    let decodedData = try decoder.decode(DashboardData.self, from: data)
                    
                    self.dateStr = decodedData.date
                    self.biometrics = decodedData.biometrics
                    self.habits = decodedData.habits
                    self.habitHistory = decodedData.habitHistory
                    self.recentWorkouts = decodedData.recentWorkouts
                    self.costcoItems = decodedData.costcoItems
                } catch {
                    print("JSON Decoding error: \(error)")
                }
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
                self.fetchData()
                return
            }
            
            print("Habit \(habitName) successfully updated on sheet to \(completed)")
            
            // Re-fetch to sync status
            self.fetchData()
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
            
            // Re-fetch to sync status
            self.fetchData()
            completion(true)
        }.resume()
    }
}
