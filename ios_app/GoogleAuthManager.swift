import Foundation
import Combine
import SwiftUI

class GoogleAuthManager: ObservableObject {
    static let shared = GoogleAuthManager()
    
    @Published var currentAccessToken: String?
    private var tokenExpirationDate: Date?
    
    func getValidAccessToken(completion: @escaping (String?) -> Void) {
        // Return existing token if it's still valid (give a 5 minute buffer)
        if let token = currentAccessToken, let exp = tokenExpirationDate, exp > Date().addingTimeInterval(300) {
            completion(token)
            return
        }
        
        let url = URL(string: "https://oauth2.googleapis.com/token")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        
        let bodyParameters = [
            "client_id": Secrets.googleClientID,
            "client_secret": Secrets.googleClientSecret,
            "refresh_token": Secrets.googleRefreshToken,
            "grant_type": "refresh_token"
        ]
        
        let bodyString = bodyParameters.map { "\($0.key)=\($0.value)" }.joined(separator: "&")
        request.httpBody = bodyString.data(using: .utf8)
        
        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            guard let data = data, error == nil else {
                print("GoogleAuthManager Error: \(error?.localizedDescription ?? "Unknown error")")
                DispatchQueue.main.async { completion(nil) }
                return
            }
            
            do {
                if let json = try JSONSerialization.jsonObject(with: data, options: []) as? [String: Any],
                   let accessToken = json["access_token"] as? String,
                   let expiresIn = json["expires_in"] as? Int {
                    
                    DispatchQueue.main.async {
                        self?.currentAccessToken = accessToken
                        self?.tokenExpirationDate = Date().addingTimeInterval(TimeInterval(expiresIn))
                        completion(accessToken)
                    }
                } else {
                    print("GoogleAuthManager Error parsing JSON: \(String(data: data, encoding: .utf8) ?? "")")
                    DispatchQueue.main.async { completion(nil) }
                }
            } catch {
                print("GoogleAuthManager Decode Error: \(error.localizedDescription)")
                DispatchQueue.main.async { completion(nil) }
            }
        }.resume()
    }
}
