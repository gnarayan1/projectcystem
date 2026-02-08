# Project CYSTEM - WordPress Migration Guide

## Overview
This guide will help you transfer your HTML/CSS page into WordPress while maintaining the design and structure.

## Step 1: Prepare Your Assets

### Images to Upload
1. **logo.png** - Your project logo
2. **background.png** - Header background image

**WordPress Steps:**
- Go to WordPress Admin > Media > Add New
- Upload both images to the Media Library
- Note the image URLs for later use

### CSS File
The extracted `style.css` contains all your styling. You can:
- Use it as a Custom CSS plugin
- Integrate it into your theme
- Use with a page builder

## Step 2: Create the Main Page

### Option A: Using WordPress Page Builder (Recommended for Beginners)
1. WordPress Admin > Pages > Add New
2. Set title: "Project CYSTEM"
3. Use a page builder like Elementor or Gutenberg blocks to recreate sections
4. Add your content section by section

### Option B: Using Code Block (Advanced)
1. Create a new Page
2. Switch editor to "Code Editor"
3. Paste the HTML content directly
4. Update image paths to WordPress URLs

## Step 3: CSS Integration

### Method 1: Custom CSS Plugin
- Install "Simple Custom CSS" or similar plugin
- Paste the entire `style.css` content into the custom CSS area

### Method 2: Child Theme
1. Create a child theme directory
2. Add `style.css` to the child theme
3. Update image paths to use WordPress uploads

### Method 3: WordPress Customizer
- WordPress Admin > Customize > Additional CSS
- Paste the CSS rules there

## Step 4: Content Structure for WordPress

### Page Layout
```
Home Page / Front Page:
├── Header Section (with logo and tagline)
├── About Project CYSTEM
├── Our Mission (with 3 cards)
├── Why PCOS Awareness Matters
├── Get Involved
└── Footer (with disclaimer)
```

### Create Individual Sections
You can either:
- Create ONE page with all sections
- Create MULTIPLE pages and link them
- Use a home/landing page template

## Step 5: Image Path Updates

When uploading to WordPress, your image URLs will look like:
```
https://your-domain.com/wp-content/uploads/2024/logo.png
https://your-domain.com/wp-content/uploads/2024/background.png
```

Update the CSS background references:
```css
header {
  background: url('https://your-domain.com/wp-content/uploads/2024/background.png');
}
```

## Step 6: HTML Content for WordPress

Below is the content broken down for easy WordPress page creation:

### Section 1: Header Content
```
Title: Project CYSTEM | PCOS Awareness & Support
Tagline: Support. Awareness. Strength.
Description: Empowering individuals with Polycystic Ovary Syndrome (PCOS) through education, advocacy, and community-driven support.
```

### Section 2: About Project CYSTEM
```
Content with logo image, covering mission and impact
```

### Section 3: Mission with Cards
```
3 Cards:
1. Education - Clear, accessible, and science-backed information
2. Awareness & Advocacy - Open conversations and challenging misconceptions  
3. Community Support - Safe, inclusive space for support
```

### Section 4-6: Additional Sections
Copy the remaining sections directly into WordPress pages or custom post types.

## Step 7: Maintain Responsiveness

The CSS already includes mobile responsiveness. When using WordPress:
- Ensure your theme is responsive
- Test on mobile devices
- Use WordPress's built-in responsive features

## Next Steps

### Phase 2 Features to Add:
1. **Contact Form** - Use Gravity Forms or WPForms
2. **Blog/News** - WordPress Posts for PCOS articles
3. **Resources Page** - Document library
4. **Community Forum** - BuddyPress or Aspen Grove Forums
5. **Gallery** - Additional images and testimonials
6. **Email Newsletter** - Mailchimp or ConvertKit integration

### Phase 3 Advanced Features:
1. **User Registration** - Member portal
2. **Member Stories** - Testimonials
3. **Resource Downloads** - PDF guides
4. **Calendar** - Events and awareness dates
5. **Analytics** - Track engagement

## Troubleshooting

**Images not showing?**
- Check the full URL path
- Ensure images are uploaded to Media Library
- Verify permissions are correct

**CSS not applying?**
- Clear browser cache
- Check plugin conflicts
- Ensure CSS selector specificity

**Responsive issues?**
- Check theme is responsive
- Test with browser dev tools
- Verify viewport meta tag is present

## Important Notes

- Keep the disclaimer in footer for legal compliance
- Test across browsers and devices
- Keep backups before major changes
- Document any custom code added

---

For support, refer to WordPress documentation: https://wordpress.org/support/
