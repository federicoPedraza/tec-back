# TEC Backend Server

A simple Express server with Nodemailer email integration for onboarding emails.

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   Create a `.env` file in the project root with:
   ```
   PORT=3000
   NODEMAILER_USER=federico.pedraza4@gmail.com
   NODEMAILER_PASSWORD=your_app_password_here
   ```

   **Important:** Replace `your_app_password_here` with your Gmail App Password:
   - Go to your Google Account settings
   - Navigate to Security → 2-Step Verification → App passwords
   - Generate a new app password for "Mail"
   - Use this 16-character password in your `.env` file as `NODEMAILER_PASSWORD`

3. **Start the server:**
   ```bash
   npm start
   ```

   For development with auto-reload:
   ```bash
   npm run dev
   ```

## API Endpoints

### Health Check
- **GET** `/` - Returns server status
- **Response:** `{"message": "Server is running!"}`

### Onboarding Email
- **POST** `/onboarding` - Sends onboarding email to user
- **Request Body:**
  ```json
  {
    "email": "user@example.com"
  }
  ```
- **Response:**
  ```json
  {
    "message": "Onboarding email sent successfully!",
    "data": { "messageId": "..." }
  }
  ```

## Testing

### Using curl:
```bash
# Test health check
curl http://localhost:3000/

# Test onboarding endpoint
curl -X POST http://localhost:3000/onboarding \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com"}'
```

### Using a REST client (Postman, Insomnia, etc.):
1. Create a POST request to `http://localhost:3000/onboarding`
2. Set Content-Type header to `application/json`
3. Add request body: `{"email": "your-email@example.com"}`

## Email Configuration

The onboarding email is sent from the email configured in `NODEMAILER_USER` using Gmail's SMTP service. The email includes:
- Welcome message
- HTML formatted content
- Professional styling

## Dependencies

- **express**: Web framework for Node.js
- **nodemailer**: Email service for sending transactional emails via SMTP
- **cors**: Cross-origin resource sharing
- **dotenv**: Environment variable management
- **nodemon**: Development dependency for auto-reloading

## Notes

- **Gmail Setup Required**: You need to generate an App Password for your Gmail account
- Enable 2-Step Verification in your Google Account before creating App Passwords
- The server runs on port 3000 by default
- Email validation is handled by the endpoint
- All errors are logged to the console for debugging

## Gmail App Password Setup

1. Go to [Google Account Settings](https://myaccount.google.com/)
2. Navigate to **Security** → **2-Step Verification**
3. Scroll down to **App passwords**
4. Select app: **Mail**
5. Select device: **Other (Custom name)**
6. Enter a name like "TEC Backend"
7. Copy the generated 16-character password
8. Use this password in your `.env` file as `EMAIL_PASS`
