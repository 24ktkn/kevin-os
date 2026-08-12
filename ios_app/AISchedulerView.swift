import SwiftUI

struct AISchedulerView: View {
    let bgColor = Color(red: 0.06, green: 0.06, blue: 0.07)
    let cardBgColor = Color(red: 0.09, green: 0.09, blue: 0.11)
    let cardBorderColor = Color(red: 0.14, green: 0.14, blue: 0.18)
    let neonGreen = Color(red: 0.0, green: 1.0, blue: 0.4)
    let cyanColor = Color(red: 0.0, green: 0.94, blue: 1.0)
    
    @State private var tasks: [String] = []
    @State private var generatedSchedule: String = ""
    @State private var isGenerating = false
    
    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("🤖 AI Scheduler")
                    .font(.system(size: 28, weight: .black, design: .rounded))
                    .foregroundColor(.white)
                Spacer()
                Button(action: fetchTasks) {
                    Image(systemName: "arrow.clockwise.circle.fill")
                        .font(.system(size: 24))
                        .foregroundColor(.white)
                }
            }
            .padding()
            .background(bgColor)
            
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    
                    // Task List
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Current Tasks")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundColor(.gray)
                            .textCase(.uppercase)
                        
                        if tasks.isEmpty {
                            Text("No tasks found. Click refresh to load from Google Tasks.")
                                .font(.system(size: 14))
                                .foregroundColor(.gray)
                                .padding()
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(cardBgColor)
                                .cornerRadius(12)
                        } else {
                            ForEach(tasks, id: \.self) { task in
                                HStack {
                                    Image(systemName: "circle")
                                        .foregroundColor(cyanColor)
                                    Text(task)
                                        .foregroundColor(.white)
                                }
                                .padding()
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(cardBgColor)
                                .cornerRadius(12)
                            }
                        }
                    }
                    .padding(.horizontal)
                    
                    Button(action: generateSchedule) {
                        HStack {
                            if isGenerating {
                                ProgressView().progressViewStyle(CircularProgressViewStyle(tint: .black))
                            }
                            Text(isGenerating ? "Gemini is thinking..." : "✨ AI Schedule My Day")
                                .font(.system(size: 16, weight: .bold))
                        }
                        .foregroundColor(.black)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(tasks.isEmpty ? Color.gray : neonGreen)
                        .cornerRadius(12)
                    }
                    .disabled(tasks.isEmpty || isGenerating)
                    .padding(.horizontal)
                    
                    if !generatedSchedule.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Your Optimized Schedule")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundColor(.gray)
                                .textCase(.uppercase)
                            
                            Text(generatedSchedule)
                                .foregroundColor(.white)
                                .padding()
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(cardBgColor)
                                .cornerRadius(12)
                                .overlay(RoundedRectangle(cornerRadius: 12).stroke(cardBorderColor, lineWidth: 1))
                        }
                        .padding(.horizontal)
                    }
                    
                    Spacer(minLength: 50)
                }
            }
            .background(bgColor.ignoresSafeArea())
        }
        .onAppear {
            if tasks.isEmpty {
                fetchTasks()
            }
        }
    }
    
    private func fetchTasks() {
        GoogleAuthManager.shared.getValidAccessToken { token in
            guard let token = token else { return }
            
            // @me is default tasklist. You could change this to fetch actual tasklists first
            let url = URL(string: "https://tasks.googleapis.com/tasks/v1/users/@me/lists")!
            var request = URLRequest(url: url)
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            
            URLSession.shared.dataTask(with: request) { data, _, _ in
                guard let data = data,
                      let json = try? JSONSerialization.jsonObject(with: data, options: []) as? [String: Any],
                      let items = json["items"] as? [[String: Any]],
                      let firstListId = items.first?["id"] as? String else {
                    return
                }
                
                let tasksUrl = URL(string: "https://tasks.googleapis.com/tasks/v1/lists/\(firstListId)/tasks?showCompleted=false")!
                var tasksReq = URLRequest(url: tasksUrl)
                tasksReq.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                
                URLSession.shared.dataTask(with: tasksReq) { tData, _, _ in
                    guard let tData = tData,
                          let tJson = try? JSONSerialization.jsonObject(with: tData, options: []) as? [String: Any],
                          let taskItems = tJson["items"] as? [[String: Any]] else {
                        return
                    }
                    
                    let fetchedTasks = taskItems.compactMap { $0["title"] as? String }
                    DispatchQueue.main.async {
                        self.tasks = fetchedTasks
                    }
                }.resume()
            }.resume()
        }
    }
    
    private func generateSchedule() {
        isGenerating = true
        GeminiManager.shared.generateSchedule(tasks: tasks, events: []) { schedule in
            self.isGenerating = false
            if let schedule = schedule {
                self.generatedSchedule = schedule
            }
        }
    }
}
