# Bri Website Structure

## Pages

### Home
- Hero section with Bri introduction
- Demo/interactive showcase
- Key features overview
- Add to Discord button (OAuth)
- Testimonials section

### Features & Documentation
- Command list with explanations
- Memory system explanation
- Character development
- Time management features
- Journal system
- Special abilities
- Usage examples/tutorials

### FAQ
- Common questions and answers
- Troubleshooting tips
- Best practices

### Blog/Updates
- Latest feature announcements
- Development updates
- Community highlights

### Dashboard (OAuth protected)
- User/Server owner toggle view

  #### Server Owner View
  - Server settings configuration
  - Credit/subscription management
  - Blocked users management
  - Feature toggles
  - Channel configuration

  #### User View
  - Memory management (mark for deletion/confirmation)
  - Character sheet information
  - Personal settings
  - Timezone preferences

### Credits & Subscriptions
- Pricing information
- Subscription tiers and benefits
- Purchase options
- Upgrade path

### Privacy & Terms
- Privacy Policy
- Terms of Service
- Data handling procedures

## Technical Implementation

### Authentication
- Discord OAuth integration
- Role-based access control

### UI/UX
- Dark theme with pastel accents
- shadcn/ui components
- Mobile-responsive design

### Security Measures
- Content moderation for user inputs
- CSRF protection
- Rate limiting
- Secure API endpoints

### Data Protection
- Sanitized inputs
- Content validation
- Proper encryption