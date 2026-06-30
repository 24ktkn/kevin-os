import SwiftUI

struct ContentView: View {
    @StateObject private var networkManager = NetworkManager()
    
    // Core color palette matching premium web app
    let bgColor = Color(red: 0.06, green: 0.06, blue: 0.07) // #0F0F12
    let cardBgColor = Color(red: 0.09, green: 0.09, blue: 0.11) // #16161D
    let cardBorderColor = Color(red: 0.14, green: 0.14, blue: 0.18) // #23232F
    let neonGreen = Color(red: 0.0, green: 1.0, blue: 0.4) // #00FF66
    let cyanColor = Color(red: 0.0, green: 0.94, blue: 1.0) // #00F0FF
    let yellowColor = Color(red: 1.0, green: 0.72, blue: 0.01) // #FFB703
    let redColor = Color(red: 1.0, green: 0.2, blue: 0.2) // #FF3333
    let lavenderColor = Color(red: 0.66, green: 0.33, blue: 0.97) // #A855F7
    
    var body: some View {
        NavigationView {
            ZStack {
                bgColor.ignoresSafeArea()
                
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        
                        // --- HEADER ---
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
                                Button(action: {
                                    networkManager.fetchData()
                                }) {
                                    Image(systemName: "arrow.clockwise.circle.fill")
                                        .font(.system(size: 24))
                                        .foregroundColor(.white)
                                }
                            }
                        }
                        .padding(.horizontal)
                        
                        // --- STEPS PROGRESS BLOCK ---
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
                                // Circular Progress Ring
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
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(cardBorderColor, lineWidth: 1)
                            )
                        }
                        .padding(.horizontal)
                        
                        // --- BIOMETRICS GRID ---
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Biometrics Command Center")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundColor(.gray)
                                .textCase(.uppercase)
                            
                            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                                // HRV Card
                                BiometricCard(title: "HRV (Variability)", 
                                             val: networkManager.biometrics.hrv > 0 ? "\(networkManager.biometrics.hrv) ms" : "No data", 
                                             color: cyanColor, 
                                             cardBg: cardBgColor, 
                                             cardBorder: cardBorderColor)
                                
                                // Sleep Duration Card
                                BiometricCard(title: "Sleep Duration", 
                                             val: networkManager.biometrics.sleep > 0 ? String(format: "%.1f hrs", networkManager.biometrics.sleep) : "No data", 
                                             color: yellowColor, 
                                             cardBg: cardBgColor, 
                                             cardBorder: cardBorderColor)
                                
                                // Wake Time Card
                                BiometricCard(title: "Wake Up Time", 
                                             val: networkManager.biometrics.wakeTime, 
                                             color: lavenderColor, 
                                             cardBg: cardBgColor, 
                                             cardBorder: cardBorderColor)
                                
                                // Resting Heart Rate Card
                                BiometricCard(title: "Resting Heart Rate", 
                                             val: networkManager.biometrics.rhr > 0 ? "\(networkManager.biometrics.rhr) bpm" : "No data", 
                                             color: redColor, 
                                             cardBg: cardBgColor, 
                                             cardBorder: cardBorderColor)
                                
                                // Bodyweight Card
                                BiometricCard(title: "Bodyweight", 
                                             val: networkManager.biometrics.weight > 0 ? String(format: "%.1f lbs", networkManager.biometrics.weight) : "No data", 
                                             color: neonGreen, 
                                             cardBg: cardBgColor, 
                                             cardBorder: cardBorderColor)
                            }
                        }
                        .padding(.horizontal)
                        
                        // --- HABITS SECTION ---
                        VStack(alignment: .leading, spacing: 8) {
                            Text("⚡ Habits Command Center")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundColor(.gray)
                                .textCase(.uppercase)
                            
                            VStack(spacing: 12) {
                                HabitRow(title: "Wake Up On Time", 
                                         icon: "⏰", 
                                         isCompleted: networkManager.habits.wakeUpOnTime, 
                                         color: lavenderColor, 
                                         cardBg: cardBgColor, 
                                         cardBorder: cardBorderColor,
                                         action: {
                                             networkManager.toggleHabit(habitName: "Wake Up On Time", completed: !networkManager.habits.wakeUpOnTime)
                                         })
                                
                                HabitRow(title: "Gym Workout", 
                                         icon: "💪", 
                                         isCompleted: networkManager.habits.gymWorkout, 
                                         color: neonGreen, 
                                         cardBg: cardBgColor, 
                                         cardBorder: cardBorderColor,
                                         action: {
                                             networkManager.toggleHabit(habitName: "Gym Workout", completed: !networkManager.habits.gymWorkout)
                                         })
                                
                                HabitRow(title: "Journaling", 
                                         icon: "✍️", 
                                         isCompleted: networkManager.habits.journaling, 
                                         color: cyanColor, 
                                         cardBg: cardBgColor, 
                                         cardBorder: cardBorderColor,
                                         action: {
                                             networkManager.toggleHabit(habitName: "Journaling", completed: !networkManager.habits.journaling)
                                         })
                            }
                        }
                        .padding(.horizontal)
                        
                    }
                    .padding(.vertical)
                }
                .refreshable {
                    networkManager.fetchData()
                }
            }
            #if os(iOS)
            .navigationBarHidden(true)
            #endif
        }
        .onAppear {
            networkManager.fetchData()
        }
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
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(cardBorder, lineWidth: 1)
        )
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
            Text(icon)
                .font(.system(size: 20))
            
            Text(title)
                .font(.system(size: 15, weight: .bold, design: .rounded))
                .foregroundColor(.white)
            
            Spacer()
            
            Button(action: action) {
                HStack(spacing: 4) {
                    if isCompleted {
                        Text("Completed")
                            .font(.system(size: 11, weight: .bold))
                        Image(systemName: "checkmark.circle.fill")
                    } else {
                        Text("Mark Done")
                            .font(.system(size: 11, weight: .bold))
                        Image(systemName: "circle")
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .foregroundColor(isCompleted ? Color.black : Color.white)
                .background(isCompleted ? color : Color.white.opacity(0.05))
                .cornerRadius(8)
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(isCompleted ? Color.clear : Color.white.opacity(0.1), lineWidth: 1)
                )
                .shadow(color: isCompleted ? color.opacity(0.3) : Color.clear, radius: 4)
            }
            .animation(.spring(), value: isCompleted)
        }
        .padding()
        .background(cardBg)
        .cornerRadius(12)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(cardBorder, lineWidth: 1)
        )
    }
}
