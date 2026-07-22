import WidgetKit
import SwiftUI
import AppIntents

// --- API CONFIGURATION ---
// IMPORTANT: Make sure this matches the API URL in NetworkManager.swift!
private nonisolated let widgetApiURLString = "https://script.google.com/macros/s/AKfycbzlQKBy3jyOv3SqhV-iqwtCQBoP7Ry-uAhTpbTJE0FhU0mZKG-KX0UlR-BB2VrVYrx5Xg/exec"

// --- INTERACTIVE APP INTENTS (iOS 17+) ---
struct ToggleHabitIntent: AppIntent {
    static var title: LocalizedStringResource = "Toggle Habit Status"
    
    @Parameter(title: "Habit Name")
    var habitName: String
    
    @Parameter(title: "Target Completion State")
    var targetCompleted: Bool
    
    init() {}
    
    init(habitName: String, targetCompleted: Bool) {
        self.habitName = habitName
        self.targetCompleted = targetCompleted
    }
    
    func perform() async throws -> some IntentResult {
        // 1. Optimistic Update (Instant Checkmark)
        UserDefaults.standard.set(targetCompleted, forKey: "opt_\(habitName)")
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: "opt_time_\(habitName)")
        
        guard let url = URL(string: widgetApiURLString) else {
            return .result()
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let payload: [String: Any] = [
            "habit": habitName,
            "completed": targetCompleted
        ]
        
        // 2. Guaranteed Background Upload (No waiting, no spinner)
        if let body = try? JSONSerialization.data(withJSONObject: payload, options: []) {
            let tempDir = FileManager.default.temporaryDirectory
            let fileURL = tempDir.appendingPathComponent(UUID().uuidString)
            try? body.write(to: fileURL)
            
            let config = URLSessionConfiguration.background(withIdentifier: "com.kevinos.bg.\(UUID().uuidString)")
            let session = URLSession(configuration: config)
            
            let task = session.uploadTask(with: request, fromFile: fileURL)
            task.resume()
        }
        
        // 3. Immediately tell WidgetKit to reload the UI using the optimistic cache
        WidgetCenter.shared.reloadAllTimelines()
        
        return .result()
    }
}

// --- WIDGET DATA TYPES ---
nonisolated struct WidgetHabits: Codable, Sendable {
    var wakeUpOnTime: Bool?
    var gymWorkout: Bool?
    var journaling: Bool?
    
    var isWakeUpOnTime: Bool { wakeUpOnTime ?? false }
    var isGymWorkout: Bool { gymWorkout ?? false }
    var isJournaling: Bool { journaling ?? false }
}

nonisolated struct WidgetBiometrics: Codable, Sendable {
    var steps: Int?
    
    enum CodingKeys: String, CodingKey {
        case steps
    }
    
    init(steps: Int?) {
        self.steps = steps
    }
    
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if let intVal = try? container.decode(Int.self, forKey: .steps) {
            self.steps = intVal
        } else if let doubleVal = try? container.decode(Double.self, forKey: .steps) {
            self.steps = Int(doubleVal)
        } else if let strVal = try? container.decode(String.self, forKey: .steps), let parsed = Int(strVal) {
            self.steps = parsed
        } else {
            self.steps = 0
        }
    }
}

nonisolated struct WidgetResponse: Codable, Sendable {
    var date: String?
    var biometrics: WidgetBiometrics?
    var habits: WidgetHabits?
}

nonisolated struct HabitEntry: TimelineEntry, Sendable {
    let date: Date
    let displayDate: String
    let steps: Int
    let habits: WidgetHabits
}

// --- TIMELINE PROVIDER ---
nonisolated struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> HabitEntry {
        HabitEntry(date: Date(), displayDate: "Today", steps: 3420, habits: WidgetHabits(wakeUpOnTime: false, gymWorkout: true, journaling: false))
    }

    func getSnapshot(in context: Context, completion: @escaping (HabitEntry) -> ()) {
        let entry = HabitEntry(date: Date(), displayDate: "Today", steps: 5640, habits: WidgetHabits(wakeUpOnTime: true, gymWorkout: true, journaling: false))
        completion(entry)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> ()) {
        guard let url = URL(string: widgetApiURLString) else {
            let entry = HabitEntry(date: Date(), displayDate: "Error", steps: 0, habits: WidgetHabits(wakeUpOnTime: false, gymWorkout: false, journaling: false))
            completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(300))))
            return
        }
        
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: 5.0)
        request.httpMethod = "GET"
        
        URLSession.shared.dataTask(with: request) { data, response, error in
            var habits = WidgetHabits(wakeUpOnTime: false, gymWorkout: false, journaling: false)
            var steps = 0
            var dateStr = "Today"
            
            if let data = data {
                do {
                    let decoded = try JSONDecoder().decode(WidgetResponse.self, from: data)
                    if let decodedHabits = decoded.habits {
                        habits = decodedHabits
                    }
                    if let decodedSteps = decoded.biometrics?.steps {
                        steps = decodedSteps
                    }
                    if let decodedDate = decoded.date {
                        dateStr = decodedDate
                    }
                } catch {
                    print("Widget decoding error: \(error)")
                }
            }
            
            // --- OPTIMISTIC UI MERGE OVERRIDE ---
            // If the user tapped the widget in the last 60 seconds, trust the local optimistic cache over the server response
            let now = Date().timeIntervalSince1970
            
            if let wakeOptTime = UserDefaults.standard.object(forKey: "opt_time_Wake Up On Time") as? Double, (now - wakeOptTime) < 60 {
                habits.wakeUpOnTime = UserDefaults.standard.bool(forKey: "opt_Wake Up On Time")
            }
            
            if let gymOptTime = UserDefaults.standard.object(forKey: "opt_time_Gym Workout") as? Double, (now - gymOptTime) < 60 {
                habits.gymWorkout = UserDefaults.standard.bool(forKey: "opt_Gym Workout")
            }
            
            if let journalOptTime = UserDefaults.standard.object(forKey: "opt_time_Journaling") as? Double, (now - journalOptTime) < 60 {
                habits.journaling = UserDefaults.standard.bool(forKey: "opt_Journaling")
            }
            // ------------------------------------
            
            let entry = HabitEntry(date: Date(), displayDate: dateStr, steps: steps, habits: habits)
            
            // Auto reload timeline every 15 minutes
            let reloadDate = Date().addingTimeInterval(900)
            let timeline = Timeline(entries: [entry], policy: .after(reloadDate))
            completion(timeline)
        }.resume()
    }
}

// --- WIDGET UI VIEWS ---
struct HabitWidgetEntryView : View {
    var entry: Provider.Entry
    
    // Premium theme color palette
    let cardBgColor = Color(red: 0.09, green: 0.09, blue: 0.11) // #16161D
    let bgColor = Color(red: 0.06, green: 0.06, blue: 0.07) // #0F0F12
    let neonGreen = Color(red: 0.0, green: 1.0, blue: 0.4) // #00FF66
    let cyanColor = Color(red: 0.0, green: 0.94, blue: 1.0) // #00F0FF
    let lavenderColor = Color(red: 0.66, green: 0.33, blue: 0.97) // #A855F7

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("🧠 OS Habits")
                    .font(.system(size: 13, weight: .black, design: .rounded))
                    .foregroundColor(.white)
                Spacer()
                Text("\(entry.steps) 👣")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundColor(neonGreen)
            }
            .padding(.bottom, 2)
            
            // Habit Interactive Rows using iOS 17 Button(intent:)
            VStack(spacing: 6) {
                // Habit 1: Wake Up On Time
                HStack {
                    Text("⏰ Wake")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.gray)
                    Spacer()
                    Button(intent: ToggleHabitIntent(habitName: "Wake Up On Time", targetCompleted: !entry.habits.isWakeUpOnTime)) {
                        Image(systemName: entry.habits.isWakeUpOnTime ? "checkmark.circle.fill" : "circle")
                            .font(.system(size: 16))
                            .foregroundColor(entry.habits.isWakeUpOnTime ? lavenderColor : .white.opacity(0.3))
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .background(Color.white.opacity(0.02))
                .cornerRadius(6)
                
                // Habit 2: Gym Workout
                HStack {
                    Text("💪 Gym")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.gray)
                    Spacer()
                    Button(intent: ToggleHabitIntent(habitName: "Gym Workout", targetCompleted: !entry.habits.isGymWorkout)) {
                        Image(systemName: entry.habits.isGymWorkout ? "checkmark.circle.fill" : "circle")
                            .font(.system(size: 16))
                            .foregroundColor(entry.habits.isGymWorkout ? neonGreen : .white.opacity(0.3))
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .background(Color.white.opacity(0.02))
                .cornerRadius(6)
                
                // Habit 3: Journaling
                HStack {
                    Text("✍️ Journal")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.gray)
                    Spacer()
                    Button(intent: ToggleHabitIntent(habitName: "Journaling", targetCompleted: !entry.habits.isJournaling)) {
                        Image(systemName: entry.habits.isJournaling ? "checkmark.circle.fill" : "circle")
                            .font(.system(size: 16))
                            .foregroundColor(entry.habits.isJournaling ? cyanColor : .white.opacity(0.3))
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .background(Color.white.opacity(0.02))
                .cornerRadius(6)
            }
        }
        .unredacted()
        .padding(12)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(bgColor)
    }
}

// --- WIDGET TARGET DEFINITION ---
@main
struct HabitWidget: Widget {
    let kind: String = "HabitWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            if #available(iOS 17.0, *) {
                HabitWidgetEntryView(entry: entry)
                    .unredacted()
                    .containerBackground(Color(red: 0.06, green: 0.06, blue: 0.07), for: .widget)
            } else {
                HabitWidgetEntryView(entry: entry)
                    .unredacted()
                    .padding()
                    .background(Color(red: 0.06, green: 0.06, blue: 0.07))
            }
        }
        .configurationDisplayName("Central OS Habits")
        .description("Instantly check off your three daily routines from your home screen.")
        .supportedFamilies([.systemSmall])
    }
}
