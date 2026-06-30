import SwiftUI

struct ContentView: View {
    @StateObject private var networkManager = NetworkManager()
    @State private var selectedTab = 0
    @State private var showingImportAlert = false
    @State private var importSuccessCount = 0
    @State private var showingImportError = false
    
    // Core color palette matching premium web app
    let bgColor = Color(red: 0.06, green: 0.06, blue: 0.07) // #0F0F12
    let cardBgColor = Color(red: 0.09, green: 0.09, blue: 0.11) // #16161D
    let cardBorderColor = Color(red: 0.14, green: 0.14, blue: 0.18) // #23232F
    let neonGreen = Color(red: 0.0, green: 1.0, blue: 0.4) // #00FF66
    let cyanColor = Color(red: 0.0, green: 0.94, blue: 1.0) // #00F0FF
    let yellowColor = Color(red: 1.0, green: 0.72, blue: 0.01) // #FFB703
    let redColor = Color(red: 1.0, green: 0.2, blue: 0.2) // #FF3333
    let lavenderColor = Color(red: 0.66, green: 0.33, blue: 0.97) // #A855F7
    
    init() {
        // Dark theme TabBar custom styling
        let appearance = UITabBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = UIColor(red: 0.09, green: 0.09, blue: 0.11, alpha: 1.0)
        UITabBar.appearance().standardAppearance = appearance
        UITabBar.appearance().scrollEdgeAppearance = appearance
        UITabBar.appearance().unselectedItemTintColor = UIColor.gray
    }
    
    var body: some View {
        TabView(selection: $selectedTab) {
            
            // --- TAB 1: CENTRAL OS HUB ---
            OSHubView(networkManager: networkManager, bgColor: bgColor, cardBgColor: cardBgColor, cardBorderColor: cardBorderColor, neonGreen: neonGreen, cyanColor: cyanColor, yellowColor: yellowColor, redColor: redColor, lavenderColor: lavenderColor)
                .tabItem {
                    Image(systemName: "gauge")
                    Text("OS Hub")
                }
                .tag(0)
            
            // --- TAB 2: WORKOUT LOGGER ---
            WorkoutLoggerView(networkManager: networkManager, bgColor: bgColor, cardBgColor: cardBgColor, cardBorderColor: cardBorderColor, neonGreen: neonGreen, cyanColor: cyanColor)
                .tabItem {
                    Image(systemName: "dumbbell.fill")
                    Text("Workouts")
                }
                .tag(1)
            
            // --- TAB 3: HABITS CHECKLIST ---
            HabitsHistoryView(networkManager: networkManager, bgColor: bgColor, cardBgColor: cardBgColor, cardBorderColor: cardBorderColor, neonGreen: neonGreen, cyanColor: cyanColor, lavenderColor: lavenderColor)
                .tabItem {
                    Image(systemName: "bolt.fill")
                    Text("Habits")
                }
                .tag(2)
            
            // --- TAB 4: MEAL PREP & COSTCO ---
            MealPrepView(networkManager: networkManager, bgColor: bgColor, cardBgColor: cardBgColor, cardBorderColor: cardBorderColor, yellowColor: yellowColor, cyanColor: cyanColor, neonGreen: neonGreen)
                .tabItem {
                    Image(systemName: "basket.fill")
                    Text("Meal Prep")
                }
                .tag(3)
        }
        .accentColor(neonGreen)
        .onAppear {
            networkManager.fetchData()
        }
        .onOpenURL { url in
            // Handle CSV file shared from iOS Share Sheet
            guard url.pathExtension.lowercased() == "csv" else { return }
            
            // Accessing security-scoped resource is optional depending on the origin of the URL.
            // We start accessing it, but we fallback to reading directly if it's not security-scoped.
            let isSecurityScoped = url.startAccessingSecurityScopedResource()
            defer {
                if isSecurityScoped {
                    url.stopAccessingSecurityScopedResource()
                }
            }
            
            do {
                let csvData = try Data(contentsOf: url)
                if let csvText = String(data: csvData, encoding: .utf8) {
                    networkManager.importHevyCSV(csvText: csvText) { success, count in
                        DispatchQueue.main.async {
                            if success {
                                self.importSuccessCount = count
                                self.showingImportAlert = true
                            } else {
                                self.showingImportError = true
                            }
                        }
                    }
                } else {
                    print("Failed to convert shared CSV data to String")
                    DispatchQueue.main.async {
                        self.showingImportError = true
                    }
                }
            } catch {
                print("Failed to read shared CSV file: \(error.localizedDescription)")
                DispatchQueue.main.async {
                    self.showingImportError = true
                }
            }
        }
        .alert(isPresented: $showingImportAlert) {
            Alert(
                title: Text("Hevy CSV Imported"),
                message: Text("Success! Discovered and added \(importSuccessCount) new workout sets to your Google Sheet without any duplicates."),
                dismissButton: .default(Text("Awesome"))
            )
        }
        // Custom warning alert on failure
        .alert(isPresented: $showingImportError) {
            Alert(
                title: Text("Import Failed"),
                message: Text("We could not import your Hevy CSV file. Make sure it is a valid workout history file and your Apps Script is deployed."),
                dismissButton: .default(Text("OK"))
            )
        }
    }
}

// =========================================================================
// 🛰️ VIEW 1: CENTRAL OS HUB
// =========================================================================
struct OSHubView: View {
    @ObservedObject var networkManager: NetworkManager
    let bgColor: Color
    let cardBgColor: Color
    let cardBorderColor: Color
    let neonGreen: Color
    let cyanColor: Color
    let yellowColor: Color
    let redColor: Color
    let lavenderColor: Color
    
    // Isolated computed properties to speed up Swift compiler type-checking
    var hrvString: String {
        networkManager.biometrics.hrv > 0 ? "\(networkManager.biometrics.hrv) ms" : "No data"
    }
    
    var sleepString: String {
        networkManager.biometrics.sleep > 0 ? String(format: "%.1f hrs", networkManager.biometrics.sleep) : "No data"
    }
    
    var rhrString: String {
        networkManager.biometrics.rhr > 0 ? "\(networkManager.biometrics.rhr) bpm" : "No data"
    }
    
    var weightString: String {
        networkManager.biometrics.weight > 0 ? String(format: "%.1f lbs", networkManager.biometrics.weight) : "No data"
    }
    
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                
                // Header
                HStack {
                    VStack(alignment: .leading) {
                        Text("🧠 Central OS")
                            .font(.system(size: 28, weight: .black, design: .rounded))
                            .foregroundColor(.white)
                        Text(networkManager.dateStr)
                            .font(.system(size: 14, weight: .bold, design: .rounded))
                            .foregroundColor(.gray)
                    }
                    Spacer()
                    if networkManager.isLoading {
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle(tint: .white))
                    } else {
                        Button(action: { networkManager.fetchData() }) {
                            Image(systemName: "arrow.clockwise.circle.fill")
                                .font(.system(size: 24))
                                .foregroundColor(.white)
                        }
                    }
                }
                .padding(.horizontal)
                .padding(.top, 8)
                
                // Daily Steps Tracker
                VStack(alignment: .leading, spacing: 8) {
                    Text("Daily Steps Tracker")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.gray)
                        .textCase(.uppercase)
                    
                    HStack {
                        VStack(alignment: .leading) {
                            Text("\(networkManager.biometrics.steps)")
                                .font(.system(size: 32, weight: .black, design: .rounded))
                                .foregroundColor(neonGreen)
                            Text("/ 10,000 steps")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundColor(.gray)
                        }
                        Spacer()
                        ZStack {
                            Circle()
                                .stroke(Color.white.opacity(0.05), lineWidth: 8)
                                .frame(width: 50, height: 50)
                            Circle()
                                .trim(from: 0.0, to: CGFloat(min(Double(networkManager.biometrics.steps) / 10000.0, 1.0)))
                                .stroke(neonGreen, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                                .frame(width: 50, height: 50)
                                .rotationEffect(Angle(degrees: -90))
                            
                            Text("\(Int(min(Double(networkManager.biometrics.steps) / 10000.0, 1.0) * 100))%")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundColor(.white)
                        }
                    }
                    .padding()
                    .background(cardBgColor)
                    .cornerRadius(12)
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(cardBorderColor, lineWidth: 1))
                }
                .padding(.horizontal)
                
                // Biometrics Grid
                VStack(alignment: .leading, spacing: 8) {
                    Text("Biometrics Command Center")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.gray)
                        .textCase(.uppercase)
                    
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                        BiometricCard(title: "HRV (Variability)", val: hrvString, color: cyanColor, cardBg: cardBgColor, cardBorder: cardBorderColor)
                        BiometricCard(title: "Sleep Duration", val: sleepString, color: yellowColor, cardBg: cardBgColor, cardBorder: cardBorderColor)
                        BiometricCard(title: "Wake Up Time", val: networkManager.biometrics.wakeTime, color: lavenderColor, cardBg: cardBgColor, cardBorder: cardBorderColor)
                        BiometricCard(title: "Resting Heart Rate", val: rhrString, color: redColor, cardBg: cardBgColor, cardBorder: cardBorderColor)
                        BiometricCard(title: "Bodyweight", val: weightString, color: neonGreen, cardBg: cardBgColor, cardBorder: cardBorderColor)
                    }
                }
                .padding(.horizontal)
                
                // Quick-Toggle Daily Habits
                VStack(alignment: .leading, spacing: 8) {
                    Text("⚡ Today's Habits")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.gray)
                        .textCase(.uppercase)
                    
                    VStack(spacing: 12) {
                        HabitRow(title: "Wake Up On Time", icon: "⏰", isCompleted: networkManager.habits.wakeUpOnTime, color: lavenderColor, cardBg: cardBgColor, cardBorder: cardBorderColor, action: {
                            networkManager.toggleHabit(habitName: "Wake Up On Time", completed: !networkManager.habits.wakeUpOnTime)
                        })
                        HabitRow(title: "Gym Workout", icon: "💪", isCompleted: networkManager.habits.gymWorkout, color: neonGreen, cardBg: cardBgColor, cardBorder: cardBorderColor, action: {
                            networkManager.toggleHabit(habitName: "Gym Workout", completed: !networkManager.habits.gymWorkout)
                        })
                        HabitRow(title: "Journaling", icon: "✍️", isCompleted: networkManager.habits.journaling, color: cyanColor, cardBg: cardBgColor, cardBorder: cardBorderColor, action: {
                            networkManager.toggleHabit(habitName: "Journaling", completed: !networkManager.habits.journaling)
                        })
                    }
                }
                .padding(.horizontal)
            }
            .padding(.vertical)
        }
        .background(bgColor.ignoresSafeArea())
        .refreshable {
            networkManager.fetchData()
        }
    }
}

// =========================================================================
// 🏋️ VIEW 2: WORKOUT LOGGER
// =========================================================================
struct WorkoutLoggerView: View {
    @ObservedObject var networkManager: NetworkManager
    let bgColor: Color
    let cardBgColor: Color
    let cardBorderColor: Color
    let neonGreen: Color
    let cyanColor: Color
    
    // Quick log variables
    @State private var exerciseName: String = "Treadmill"
    @State private var reps: Int = 10
    @State private var weight: Double = 0.0
    @State private var duration: Double = 20.0
    @State private var distance: Double = 2.0
    @State private var splitDay: String = "Cardio"
    @State private var showingSuccessAlert = false
    @State private var isSubmitting = false
    
    let exercisesList = ["Treadmill", "Bench Press (Dumbbell)", "Bench Press (Barbell)", "Squat (Barbell)", "Bent Over Row (Barbell)", "Pull Up", "Romanian Deadlift (Barbell)", "Lateral Raise (Cable)", "Triceps Extension (Cable)", "Seated Incline Curl (Dumbbell)"]
    let splitsList = ["Cardio", "Push (Chest/Shoulders/Triceps)", "Pull (Back/Biceps)", "Legs & Abs"]
    
    // Computed property to prevent compilation type-check timeouts
    var recentWorkoutsList: [WorkoutSet] {
        Array(networkManager.recentWorkouts.prefix(15))
    }
    
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                
                // Title
                Text("🏋️ Workouts Ledger")
                    .font(.system(size: 28, weight: .black, design: .rounded))
                    .foregroundColor(.white)
                    .padding(.horizontal)
                    .padding(.top, 8)
                
                // Quick Logging Form
                VStack(alignment: .leading, spacing: 12) {
                    Text("Log Workout Set")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundColor(.white)
                    
                    // Select Split
                    HStack {
                        Text("Workout Split:")
                            .font(.system(size: 13, weight: .semibold)).foregroundColor(.gray)
                        Spacer()
                        Picker("Split", selection: $splitDay) {
                            ForEach(splitsList, id: \.self) { Text($0.prefix(12)).tag($0) }
                        }
                        .pickerStyle(MenuPickerStyle())
                        .foregroundColor(.white)
                    }
                    Divider().background(Color.white.opacity(0.1))
                    
                    // Select/Enter Exercise
                    HStack {
                        Text("Exercise Name:")
                            .font(.system(size: 13, weight: .semibold)).foregroundColor(.gray)
                        Spacer()
                        Picker("Exercise", selection: $exerciseName) {
                            ForEach(exercisesList, id: \.self) { Text($0).tag($0) }
                        }
                        .pickerStyle(MenuPickerStyle())
                        .foregroundColor(.white)
                    }
                    
                    // Numeric Steppers
                    VStack(spacing: 8) {
                        if exerciseName.lowercased().contains("treadmill") {
                            // Duration
                            HStack {
                                Text("Duration (Mins)")
                                    .font(.system(size: 13, weight: .semibold)).foregroundColor(.gray)
                                Spacer()
                                Stepper("\(String(format: "%.1f", duration))m", value: $duration, in: 1.0...180.0, step: 0.5)
                                    .foregroundColor(.white)
                                    .frame(width: 140)
                            }
                            // Distance
                            HStack {
                                Text("Distance (Miles)")
                                    .font(.system(size: 13, weight: .semibold)).foregroundColor(.gray)
                                Spacer()
                                Stepper("\(String(format: "%.2f", distance)) mi", value: $distance, in: 0.0...26.0, step: 0.1)
                                    .foregroundColor(.white)
                                    .frame(width: 140)
                            }
                        } else {
                            // Weight
                            HStack {
                                Text("Working Weight (lbs)")
                                    .font(.system(size: 13, weight: .semibold)).foregroundColor(.gray)
                                Spacer()
                                Stepper("\(Int(weight)) lbs", value: $weight, in: 0.0...600.0, step: 5.0)
                                    .foregroundColor(.white)
                                    .frame(width: 140)
                            }
                            // Repetitions
                            HStack {
                                Text("Reps Completed")
                                    .font(.system(size: 13, weight: .semibold)).foregroundColor(.gray)
                                Spacer()
                                Stepper("\(reps) reps", value: $reps, in: 0...50)
                                    .foregroundColor(.white)
                                    .frame(width: 140)
                            }
                        }
                    }
                    
                    // Submit Button
                    Button(action: {
                        isSubmitting = true
                        networkManager.logWorkoutSet(exercise: exerciseName, weight: weight, reps: reps, duration: duration, distance: distance, splitDay: splitDay) { success in
                            DispatchQueue.main.async {
                                isSubmitting = false
                                if success {
                                    showingSuccessAlert = true
                                    // Reset fields
                                    self.weight = 0.0
                                    self.reps = 10
                                }
                            }
                        }
                    }) {
                        HStack {
                            if isSubmitting {
                                ProgressView().progressViewStyle(CircularProgressViewStyle(tint: .black))
                            } else {
                                Image(systemName: "checkmark.seal.fill")
                                Text("Upload Set to Sheets")
                                    .font(.system(size: 14, weight: .black, design: .rounded))
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(neonGreen)
                        .foregroundColor(.black)
                        .cornerRadius(10)
                        .shadow(color: neonGreen.opacity(0.3), radius: 5)
                    }
                    .disabled(isSubmitting)
                }
                .padding()
                .background(cardBgColor)
                .cornerRadius(12)
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(cardBorderColor, lineWidth: 1))
                .padding(.horizontal)
                .alert(isPresented: $showingSuccessAlert) {
                    Alert(title: Text("Log Injected"), message: Text("Success! This set has been pushed to Google Sheets and your 'Gym Workout' habit checked off!"), dismissButton: .default(Text("Perfect")))
                }
                
                // Recent Sets List
                VStack(alignment: .leading, spacing: 8) {
                    Text("Recent Training Logs")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.gray)
                        .textCase(.uppercase)
                        .padding(.horizontal)
                    
                    if recentWorkoutsList.isEmpty {
                        Text("No recent workout history found.")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(.gray)
                            .padding()
                            .frame(maxWidth: .infinity)
                            .background(cardBgColor)
                            .cornerRadius(12)
                            .padding(.horizontal)
                    } else {
                        VStack(spacing: 8) {
                            ForEach(recentWorkoutsList) { setRow in
                                HStack {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(setRow.exercise)
                                            .font(.system(size: 14, weight: .black, design: .rounded))
                                            .foregroundColor(.white)
                                        Text("\(setRow.date) • Set \(setRow.setNumber)")
                                            .font(.system(size: 11, weight: .bold))
                                            .foregroundColor(.gray)
                                    }
                                    Spacer()
                                    
                                    // Metrics display
                                    if setRow.exercise.lowercased().contains("treadmill") {
                                        VStack(alignment: .trailing) {
                                            Text(String(format: "%.2f km", setRow.distance))
                                                .font(.system(size: 14, weight: .bold, design: .rounded))
                                                .foregroundColor(cyanColor)
                                            Text(String(format: "%.1f mins", setRow.duration))
                                                .font(.system(size: 11))
                                                .foregroundColor(.gray)
                                        }
                                    } else {
                                        VStack(alignment: .trailing) {
                                            Text("\(Int(setRow.weight)) lbs")
                                                .font(.system(size: 14, weight: .bold, design: .rounded))
                                                .foregroundColor(neonGreen)
                                            Text("\(setRow.reps) reps")
                                                .font(.system(size: 11))
                                                .foregroundColor(.gray)
                                        }
                                    }
                                }
                                .padding()
                                .background(cardBgColor)
                                .cornerRadius(10)
                                .overlay(RoundedRectangle(cornerRadius: 10).stroke(cardBorderColor, lineWidth: 1))
                            }
                        }
                        .padding(.horizontal)
                    }
                }
            }
            .padding(.vertical)
        }
        .background(bgColor.ignoresSafeArea())
    }
}

// =========================================================================
// ⚡ VIEW 3: HABITS CHECKLIST
// =========================================================================
struct HabitsHistoryView: View {
    @ObservedObject var networkManager: NetworkManager
    let bgColor: Color
    let cardBgColor: Color
    let cardBorderColor: Color
    let neonGreen: Color
    let cyanColor: Color
    let lavenderColor: Color
    
    // Computed property to prevent compilation type-check timeouts
    var recentHabitsList: [HabitDay] {
        Array(networkManager.habitHistory.prefix(7))
    }
    
    // Streaks calculations
    var currentStreak: Int {
        var streak = 0
        for day in networkManager.habitHistory {
            // Count a day if they hit at least 2 habits
            let hitCount = (day.wakeUpOnTime ? 1 : 0) + (day.gymWorkout ? 1 : 0) + (day.journaling ? 1 : 0)
            if hitCount >= 2 {
                streak += 1
            } else {
                break
            }
        }
        return streak
    }
    
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                
                // Title
                Text("⚡ Streak & Habit OS")
                    .font(.system(size: 28, weight: .black, design: .rounded))
                    .foregroundColor(.white)
                    .padding(.horizontal)
                    .padding(.top, 8)
                
                // Streak Card
                VStack(alignment: .center, spacing: 6) {
                    Text("Habit Streak")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.gray)
                        .textCase(.uppercase)
                    
                    Text("\(currentStreak) Days")
                        .font(.system(size: 42, weight: .black, design: .rounded))
                        .foregroundColor(neonGreen)
                    
                    Text("Consistently hitting 2+ habits daily")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.gray)
                }
                .frame(maxWidth: .infinity)
                .padding()
                .background(cardBgColor)
                .cornerRadius(12)
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(cardBorderColor, lineWidth: 1))
                .padding(.horizontal)
                
                // Last 7 Days Grid
                VStack(alignment: .leading, spacing: 8) {
                    Text("7-Day Habit Ledger")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.gray)
                        .textCase(.uppercase)
                        .padding(.horizontal)
                    
                    if recentHabitsList.isEmpty {
                        Text("No habit history synced yet.")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(.gray)
                            .padding()
                            .frame(maxWidth: .infinity)
                            .background(cardBgColor)
                            .cornerRadius(12)
                            .padding(.horizontal)
                    } else {
                        VStack(spacing: 8) {
                            ForEach(recentHabitsList) { day in
                                HStack {
                                    Text(formatDateLabel(day.date))
                                        .font(.system(size: 14, weight: .bold, design: .rounded))
                                        .foregroundColor(.white)
                                    Spacer()
                                    
                                    // Visual switches
                                    HStack(spacing: 12) {
                                        MiniHabitBadge(icon: "⏰", status: day.wakeUpOnTime, activeColor: lavenderColor)
                                        MiniHabitBadge(icon: "💪", status: day.gymWorkout, activeColor: neonGreen)
                                        MiniHabitBadge(icon: "✍️", status: day.journaling, activeColor: cyanColor)
                                    }
                                }
                                .padding()
                                .background(cardBgColor)
                                .cornerRadius(10)
                                .overlay(RoundedRectangle(cornerRadius: 10).stroke(cardBorderColor, lineWidth: 1))
                            }
                        }
                        .padding(.horizontal)
                    }
                }
            }
            .padding(.vertical)
        }
        .background(bgColor.ignoresSafeArea())
    }
    
    func formatDateLabel(_ dateString: String) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        if let date = formatter.date(from: dateString) {
            let outputFormatter = DateFormatter()
            outputFormatter.dateFormat = "E, MMM d"
            return outputFormatter.string(from: date)
        }
        return dateString
    }
}

struct MiniHabitBadge: View {
    let icon: String
    let status: Bool
    let activeColor: Color
    
    var body: some View {
        HStack(spacing: 4) {
            Text(icon).font(.system(size: 12))
            Image(systemName: status ? "checkmark.circle.fill" : "xmark.circle")
                .foregroundColor(status ? .black : .gray.opacity(0.4))
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(status ? activeColor : Color.white.opacity(0.05))
        .cornerRadius(6)
    }
}

// =========================================================================
// 🥗 VIEW 4: MEAL PREP & COSTCO CHECKLIST
// =========================================================================
struct MealPrepView: View {
    @ObservedObject var networkManager: NetworkManager
    let bgColor: Color
    let cardBgColor: Color
    let cardBorderColor: Color
    let yellowColor: Color
    let cyanColor: Color
    let neonGreen: Color
    
    @State private var selectedTripIdx = 0
    @State private var activeWeek = 1
    
    // Store checklist items completed states on device
    @AppStorage("completed_costco_items") private var completedItemsData: String = ""
    
    // Computed property for Costco checklist filtering
    var filteredCostcoItems: [CostcoItem] {
        let filter = selectedTripIdx == 0 ? "trip 1" : "trip 2"
        return networkManager.costcoItems.filter { $0.trip.lowercased().contains(filter) }
    }
    
    // Computed property for Costco checklist department grouping
    var groupedCostcoItems: [String: [CostcoItem]] {
        Dictionary(grouping: filteredCostcoItems, by: { $0.department })
    }
    
    // Computed property to prevent sorted departments type-check timeouts
    var sortedDepartments: [String] {
        groupedCostcoItems.keys.sorted()
    }
    
    var completedItems: Set<String> {
        let list = completedItemsData.components(separatedBy: ",")
        return Set(list.filter { !$0.isEmpty })
    }
    
    // Bridging completedItems to the subview in a non-mutating way by writing directly to UserDefaults
    var completedItemsBinding: Binding<Set<String>> {
        Binding(
            get: { self.completedItems },
            set: { newValue in
                let str = Array(newValue).joined(separator: ",")
                UserDefaults.standard.set(str, forKey: "completed_costco_items")
            }
        )
    }
    
    // Computed properties for Weekly Menu Blueprint
    var smoothieFruit: String {
        activeWeek % 2 == 1 ? "Frozen Mango Chunks" : "Frozen Three Berry Blend"
    }
    
    var lunchTitle: String {
        activeWeek <= 2 ? "Beef, Egg, & Fresh Spinach Burritos" : "Zero-Prep Pulled Chicken & Spinach Wraps"
    }
    
    var lunchGuide: String {
        activeWeek <= 2 ?
            "Warm up seasoned ground beef, scramble fresh eggs, and roll tightly into 2 wraps packed with raw fresh spinach." :
            "Layer 2 wraps with fresh spinach and stuff with cold rotisserie chicken. Add hot sauce, wrap, and pack."
    }
    
    var dinnerProt: String {
        activeWeek == 1 ? "Seasoned Chicken Breasts" : (activeWeek == 2 ? "Kirkland Frozen Salmon Fillets" : (activeWeek == 3 ? "Seasoned Chicken Breasts" : "Thawed Tail-Off Shrimp"))
    }
    
    var dinnerVeg: String {
        activeWeek <= 2 ? "Frozen Broccoli & Corn" : "Frozen Stir-Fry Veg Blend"
    }
    
    var airfryTime: String {
        activeWeek == 4 ? "6 minutes at 400°F" : "15-18 minutes at 400°F"
    }
    
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                
                // Title
                Text("🥗 Meal Prep Planner")
                    .font(.system(size: 28, weight: .black, design: .rounded))
                    .foregroundColor(.white)
                    .padding(.horizontal)
                    .padding(.top, 8)
                
                // Segment Trip Selector
                Picker("Shopping Trip", selection: $selectedTripIdx) {
                    Text("Trip 1 (Master Stock)").tag(0)
                    Text("Trip 2 (Refresh)").tag(1)
                }
                .pickerStyle(SegmentedPickerStyle())
                .padding(.horizontal)
                
                // Costco Shopping checklist
                VStack(alignment: .leading, spacing: 8) {
                    Text("Costco Grocery Checklist")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.gray)
                        .textCase(.uppercase)
                        .padding(.horizontal)
                    
                    if filteredCostcoItems.isEmpty {
                        Text("No grocery items loaded. Pull down to refresh.")
                            .font(.system(size: 13))
                            .foregroundColor(.gray)
                            .padding()
                            .frame(maxWidth: .infinity)
                            .background(cardBgColor)
                            .cornerRadius(12)
                            .padding(.horizontal)
                    } else {
                        VStack(alignment: .leading, spacing: 12) {
                            ForEach(sortedDepartments, id: \.self) { dept in
                                VStack(alignment: .leading, spacing: 6) {
                                    // Department Header
                                    Text(dept.uppercased())
                                        .font(.system(size: 12, weight: .black))
                                        .foregroundColor(yellowColor)
                                        .padding(.top, 4)
                                    
                                    // Items Checklist
                                    ForEach(groupedCostcoItems[dept] ?? []) { item in
                                        CostcoItemRow(
                                            item: item,
                                            completedItems: completedItemsBinding,
                                            neonGreen: neonGreen,
                                            cardBgColor: cardBgColor,
                                            cardBorderColor: cardBorderColor
                                        )
                                    }
                                }
                            }
                        }
                        .padding(.horizontal)
                    }
                }
                
                Divider().background(Color.white.opacity(0.1)).padding(.horizontal)
                
                // Week Agenda Blueprint selector
                VStack(alignment: .leading, spacing: 8) {
                    Text("Weekly Menu Blueprint")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.gray)
                        .textCase(.uppercase)
                        .padding(.horizontal)
                    
                    Picker("Rotation Week", selection: $activeWeek) {
                        Text("Week 1").tag(1)
                        Text("Week 2").tag(2)
                        Text("Week 3").tag(3)
                        Text("Week 4").tag(4)
                    }
                    .pickerStyle(SegmentedPickerStyle())
                    .padding(.horizontal)
                    
                    VStack(spacing: 12) {
                        MealCard(title: "🌅 Breakfast (Blender)", name: "High-Protein Smoothie", workflow: "1.5 cups Milk, 1 cup Vanilla Yogurt, 1 cup \(smoothieFruit), 1 tbsp Chia Seeds, 3 tbsp Hemp Hearts. Swap yogurt with cottage cheese for extra thickness!")
                        
                        MealCard(title: "☀️ Mid-Day Fuel (2 Wraps)", name: lunchTitle, workflow: lunchGuide)
                        
                        MealCard(title: "🌙 Dinner (Air Fryer core)", name: "\(dinnerProt) on Starch Grid", workflow: "Air-fry protein for \(airfryTime). Starch: cooked Jasmine Rice/Quinoa blend. Stir in 2-3 tbsp cottage cheese immediately for a creamy high-protein base! Veg: steam \(dinnerVeg) in microwave at dinner.")
                        
                        MealCard(title: "🌙 Study Fuel (Casein Feed)", name: "Cottage Cheese & Warm Berries", workflow: "1 cup cottage cheese, top with Frozen Berries microwaved for 20 seconds to run the juices. Slow casein protein protects recovery overnight!")
                    }
                    .padding(.horizontal)
                }
            }
            .padding(.vertical)
        }
        .background(bgColor.ignoresSafeArea())
    }
}

// Extracted Subview to fix compile speed issues in SwiftUI lists
struct CostcoItemRow: View {
    let item: CostcoItem
    @Binding var completedItems: Set<String>
    let neonGreen: Color
    let cardBgColor: Color
    let cardBorderColor: Color
    
    var isChecked: Bool {
        completedItems.contains(item.id)
    }
    
    var body: some View {
        Button(action: {
            if isChecked {
                completedItems.remove(item.id)
            } else {
                completedItems.insert(item.id)
            }
        }) {
            HStack(alignment: .top) {
                Image(systemName: isChecked ? "checkmark.square.fill" : "square")
                    .foregroundColor(isChecked ? neonGreen : .gray)
                    .font(.system(size: 16))
                    .padding(.top, 2)
                
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.name)
                        .font(.system(size: 14, weight: .bold, design: .rounded))
                        .foregroundColor(isChecked ? .gray : .white)
                        .strikethrough(isChecked)
                    Text("\(item.size) • \(item.assignment)")
                        .font(.system(size: 11))
                        .foregroundColor(.gray)
                }
                Spacer()
            }
            .padding(.vertical, 8)
            .padding(.horizontal, 10)
            .background(cardBgColor)
            .cornerRadius(8)
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(cardBorderColor, lineWidth: 0.5))
        }
    }
}

struct MealCard: View {
    let title: String
    let name: String
    let workflow: String
    
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.system(size: 10, weight: .bold))
                .foregroundColor(.gray)
                .textCase(.uppercase)
            
            Text(name)
                .font(.system(size: 15, weight: .black, design: .rounded))
                .foregroundColor(.white)
            
            Text(workflow)
                .font(.system(size: 12))
                .foregroundColor(.gray)
                .lineLimit(4)
                .lineSpacing(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Color(red: 0.09, green: 0.09, blue: 0.11))
        .cornerRadius(10)
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color(red: 0.14, green: 0.14, blue: 0.18), lineWidth: 1))
    }
}

struct BiometricCard: View {
    let title: String
    let val: String
    let color: Color
    let cardBg: Color
    let cardBorder: Color
    
    var body: some View {
        VStack(alignment: .center, spacing: 6) {
            Text(title)
                .font(.system(size: 10, weight: .bold))
                .foregroundColor(.gray)
                .textCase(.uppercase)
                .multilineTextAlignment(.center)
            
            Text(val)
                .font(.system(size: 18, weight: .black, design: .rounded))
                .foregroundColor(color)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 16)
        .padding(.horizontal, 10)
        .background(cardBg)
        .cornerRadius(10)
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(cardBorder, lineWidth: 1))
    }
}

struct HabitRow: View {
    let title: String
    let icon: String
    let isCompleted: Bool
    let color: Color
    let cardBg: Color
    let cardBorder: Color
    let action: () -> Void
    
    var body: some View {
        HStack {
            Text(icon).font(.system(size: 20))
            
            Text(title)
                .font(.system(size: 15, weight: .bold, design: .rounded))
                .foregroundColor(.white)
            
            Spacer()
            
            Button(action: action) {
                HStack(spacing: 4) {
                    if isCompleted {
                        Text("Completed").font(.system(size: 11, weight: .bold))
                        Image(systemName: "checkmark.circle.fill")
                    } else {
                        Text("Mark Done").font(.system(size: 11, weight: .bold))
                        Image(systemName: "circle")
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .foregroundColor(isCompleted ? Color.black : Color.white)
                .background(isCompleted ? color : Color.white.opacity(0.05))
                .cornerRadius(8)
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(isCompleted ? Color.clear : Color.white.opacity(0.1), lineWidth: 1))
                .shadow(color: isCompleted ? color.opacity(0.3) : Color.clear, radius: 4)
            }
            .animation(.spring(), value: isCompleted)
        }
        .padding()
        .background(cardBg)
        .cornerRadius(12)
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(cardBorder, lineWidth: 1))
    }
}
