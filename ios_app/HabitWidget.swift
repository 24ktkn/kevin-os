import WidgetKit
import SwiftUI
import AppIntents

// --- API CONFIGURATION ---
// IMPORTANT: Make sure this matches the API URL in NetworkManager.swift!
private let widgetApiURLString = "https://script.google.com/macros/s/AKfycbzlQKBy3jyOv3SqhV-iqwtCQBoP7Ry-uAhTpbTJE0FhU0mZKG-KX0UlR-BB2VrVYrx5Xg/exec"

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
        
        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: payload, options: [])
            
            // Perform asynchronous call
            let (_, response) = try await URLSession.shared.data(for: request)
            if let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 {
                print("Widget successfully toggled \(habitName) to \(targetCompleted)")
            }
        } catch {
            print("Widget failed to toggle habit: \(error.localizedDescription)")
        }
        
        // Force reload the widget timeline to show the updated checked state immediately on the home screen
        WidgetCenter.shared.reloadAllTimelines()
        
        return .result()
    }
}

// --- WIDGET DATA TYPES ---
struct WidgetHabits: Codable {
    var wakeUpOnTime: Bool
    var gymWorkout: Bool
    var journaling: Bool
}

struct WidgetBiometrics: Codable {
    var steps: Int
}

struct WidgetResponse: Codable {
    var date: String
    var biometrics: WidgetBiometrics
    var habits: WidgetHabits
}

struct HabitEntry: TimelineEntry {
    let date: Date
    let displayDate: String
    let steps: Int
    let habits: WidgetHabits
}

// --- TIMELINE PROVIDER ---
struct Provider: TimelineProvider {
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
        
        URLSession.shared.dataTask(with: url) { data, response, error in
            var habits = WidgetHabits(wakeUpOnTime: false, gymWorkout: false, journaling: false)
            var steps = 0
            var dateStr = "No connection"
            
            if let data = data {
                do {
                    let decoded = try JSONDecoder().decode(WidgetResponse.self, from: data)
                    habits = decoded.habits
                    steps = decoded.biometrics.steps
                    dateStr = decoded.date
                } catch {
                    print("Widget decoding error: \(error)")
                }
            }
            
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
                    Button(intent: ToggleHabitIntent(habitName: "Wake Up On Time", targetCompleted: !entry.habits.wakeUpOnTime)) {
                        Image(systemName: entry.habits.wakeUpOnTime ? "checkmark.circle.fill" : "circle")
                            .font(.system(size: 16))
                            .foregroundColor(entry.habits.wakeUpOnTime ? lavenderColor : .white.opacity(0.3))
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
                    Button(intent: ToggleHabitIntent(habitName: "Gym Workout", targetCompleted: !entry.habits.gymWorkout)) {
                        Image(systemName: entry.habits.gymWorkout ? "checkmark.circle.fill" : "circle")
                            .font(.system(size: 16))
                            .foregroundColor(entry.habits.gymWorkout ? neonGreen : .white.opacity(0.3))
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
                    Button(intent: ToggleHabitIntent(habitName: "Journaling", targetCompleted: !entry.habits.journaling)) {
                        Image(systemName: entry.habits.journaling ? "checkmark.circle.fill" : "circle")
                            .font(.system(size: 16))
                            .foregroundColor(entry.habits.journaling ? cyanColor : .white.opacity(0.3))
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .background(Color.white.opacity(0.02))
                .cornerRadius(6)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(bgColor)
    }
}

// --- WIDGET TARGET DEFINITION ---
struct HabitWidget: Widget {
    let kind: String = "HabitWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            if #available(iOS 17.0, *) {
                HabitWidgetEntryView(entry: entry)
                    .containerBackground(Color(red: 0.06, green: 0.06, blue: 0.07), for: .widget)
            } else {
                HabitWidgetEntryView(entry: entry)
                    .padding()
                    .background(Color(red: 0.06, green: 0.06, blue: 0.07))
            }
        }
        .configurationDisplayName("Central OS Habits")
        .description("Instantly check off your three daily routines from your home screen.")
        .supportedFamilies([.systemSmall])
    }
}
