# Project CYSTEM - Node.js Implementation

A modern, secure contact form implementation for Project CYSTEM using Node.js/Express with reCAPTCHA v3 spam protection and SMTP email delivery.

## Features

- ✅ Secure contact form with server-side validation
- ✅ Google reCAPTCHA v3 integration (invisible spam detection)
- ✅ Honeypot field (catches automated bots)
- ✅ Rate limiting (max 5 submissions per IP per hour)
- ✅ SMTP email delivery (Gmail, SendGrid, etc.)
- ✅ Responsive design with modern UI
- ✅ Confirmation emails to users
- ✅ Environment-based configuration (no hardcoded secrets)
- ✅ Security headers (Helmet.js)

## Quick Start

### 1. Prerequisites

- Node.js 18+ ([download](https://nodejs.org/))
- npm or yarn
- GitHub account (for version control, optional)

### 2. Installation

```bash
# Navigate to project directory
cd projectcystem

# Install dependencies
npm install

# Copy environment template and add your keys
cp .env.example .env
```

### 3. Configure Environment Variables

Edit `.env` file with your configuration:

```env
PORT=3000
RECAPTCHA_SITE_KEY=your_recaptcha_v3_site_key
RECAPTCHA_SECRET_KEY=your_recaptcha_v3_secret_key
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
MAIL_TO=projectcystem@gmail.com
```

### 4. Update reCAPTCHA Site Key in Frontend

Edit `public/index.html` and `public/contact-form.js`, replace:
- `YOUR_RECAPTCHA_SITE_KEY` with your actual reCAPTCHA v3 site key

### 5. Run Locally

```bash
# Development (with hot reload)
npm run dev

# Production
npm start
```

Visit `http://localhost:3000` in your browser.

## Setup Guides

### Google reCAPTCHA v3

1. Go to [Google reCAPTCHA Admin Console](https://www.google.com/recaptcha/admin)
2. Click **"Create"** or **"+"**
3. Fill in:
   - **Label:** Project CYSTEM
   - **reCAPTCHA type:** reCAPTCHA v3
   - **Domains:** your-domain.com, localhost (for testing)
4. Copy **Site Key** and **Secret Key**
5. Paste into `.env` file and `public/index.html`

### Gmail SMTP Setup

1. Enable 2-Factor Authentication on your Gmail account
2. Generate an **App Password**:
   - Go to [Google Account Settings](https://myaccount.google.com/security)
   - Click **App passwords** (appears only if 2FA is enabled)
   - Select **Mail** and **Windows Computer** (or your device)
   - Google generates a 16-character password
3. Add to `.env`:
   ```env
   SMTP_USER=your-email@gmail.com
   SMTP_PASS=your-16-character-app-password
   ```

**Alternative:** Use SendGrid, Mailgun, or AWS SES for higher volume.

### Deployment to AWS Lightsail

#### Option A: Manual Deployment (Linux Instance)

```bash
# SSH into Lightsail instance
ssh -i your-key.pem ubuntu@your-instance-ip

# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone or upload your project
git clone https://github.com/yourusername/projectcystem.git
cd projectcystem

# Install dependencies
npm install

# Create .env file with your secrets
nano .env
# (paste your configuration, then Ctrl+O, Enter, Ctrl+X)

# Install PM2 (process manager)
sudo npm install -g pm2

# Start app with PM2
pm2 start server.js --name "projectcystem"
pm2 startup
pm2 save

# Set up Nginx reverse proxy (optional, recommended for production)
sudo apt install nginx -y
# Configure nginx to proxy to localhost:3000
```

#### Option B: Docker Deployment (Lightsail Container Service)

1. Create `Dockerfile`:
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

2. Create `.dockerignore`:
```
node_modules
npm-debug.log
.env
.git
```

3. Build and push to AWS ECR (or Docker Hub):
```bash
docker build -t projectcystem:1.0.0 .
docker tag projectcystem:1.0.0 your-registry/projectcystem:1.0.0
docker push your-registry/projectcystem:1.0.0
```

4. Deploy via Lightsail Container Service in AWS Console

#### Option C: Use AWS Lightsail Blueprints

Look for "Node.js" blueprint in Lightsail console and customize.

### Setting Up an SSL Certificate (HTTPS)

For production on Lightsail:

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx -y

# Get free certificate from Let's Encrypt
sudo certbot certonly --standalone -d your-domain.com -d www.your-domain.com

# Auto-renew certificates
sudo systemctl enable certbot.timer
sudo systemctl start certbot.timer
```

## File Structure

```
projectcystem/
├── public/
│   ├── index.html              # Main page + contact form
│   ├── style.css               # Styles (including form)
│   ├── contact-form.js         # Client-side form handler
│   ├── logo.png                # Logo image
│   ├── background.png          # Header background
│   └── [other assets]
├── server.js                   # Express backend + contact endpoint
├── package.json                # Dependencies
├── .env.example                # Environment template
├── .env                        # Your configuration (git-ignored)
├── .gitignore                  # Files to ignore in Git
└── README.md                   # This file
```

## API Reference

### POST /contact

Handles contact form submissions.

**Request:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "message": "Your message here",
  "g-recaptcha-response": "token-from-recaptcha",
  "hp_contact": ""
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Your message has been sent successfully!"
}
```

**Error Response (400/500):**
```json
{
  "error": "Please fill in all fields."
}
```

## Troubleshooting

### "reCAPTCHA verification failed"
- Check `RECAPTCHA_SECRET_KEY` in `.env`
- Ensure site key in `public/index.html` matches your admin console
- Verify domain is added to reCAPTCHA settings

### "An error occurred. Please try again later" (when sending)
- Check SMTP credentials in `.env`
- Verify `MAIL_TO` email is valid
- For Gmail: ensure App Password is correct (16 characters, spaces removed)
- Check inbox spam folder
- Review server logs: `pm2 logs projectcystem`

### Form not submitting
- Open browser console (F12) for JavaScript errors
- Check network tab to see request/response
- Ensure `contact-form.js` loaded successfully
- Verify reCAPTCHA script loaded (check page source)

### Email goes to spam
- Use SMTP instead of PHP `mail()` function
- Set proper email headers and domain
- Consider AWS SES for better deliverability
- Add SPF/DKIM records for your domain

## Security Best Practices

✅ **Implemented:**
- Environment variables for secrets (no hardcoding)
- Server-side validation and sanitization
- Honeypot field for bot detection
- reCAPTCHA v3 for spam prevention
- Rate limiting to prevent abuse
- Helmet.js for HTTP security headers
- SMTP over TLS (not insecure `mail()`)

✅ **Recommended (additional):**
- Enable HTTPS/SSL in production
- Set up CORS if frontend is on different domain
- Implement CSRF tokens if needed
- Use Content Security Policy (CSP) headers
- Regular dependency updates: `npm audit`, `npm update`

## Monitoring & Logs

### View Live Logs (with PM2)
```bash
pm2 logs projectcystem
pm2 logs projectcystem --lines 100  # Last 100 lines
```

### Check Health
```bash
curl http://localhost:3000/health
```

### Monitor Submissions
Currently, submissions are logged to console. For production, consider:
- Store submissions in MongoDB/Firebase
- Send to analytics platform (Mixpanel, Segment)
- Create admin dashboard to view submissions

## Next Steps

1. **Customize Email Templates**: Edit the HTML in `server.js` (lines for `mailOptions.html`)
2. **Add More Fields**: Add form fields in `public/index.html` and validate in `server.js`
3. **Database Integration**: Store submissions in MongoDB/PostgreSQL
4. **Admin Panel**: Create a dashboard to view/manage submissions
5. **Analytics**: Track form submissions, conversion rates, etc.

## Support

For issues or questions:
- Check the Troubleshooting section above
- Review server logs: `pm2 logs projectcystem`
- Check browser console for client-side errors
- Verify `.env` configuration matches your services

## License

MIT

---

**Last Updated:** February 2026
