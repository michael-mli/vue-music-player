# Test Lyrics with Image Support

This is a test file to demonstrate the image support in lyrics. Here's what the lyrics content might look like:

## Example Lyrics Content
```
Beautiful Song Title

Verse 1:
This is the first verse of the song
With some beautiful lyrics here

<img src="https://via.placeholder.com/400x200/FF6B6B/FFFFFF?text=Album+Cover" alt="Album Cover" title="Beautiful Song Album Cover" />

Chorus:
This is the chorus part
Everyone sing along
La la la la la

Verse 2:
Another verse with more content
<img src="https://via.placeholder.com/300x150/4ECDC4/FFFFFF?text=Music+Note" alt="Music Note" title="Musical Note Illustration" />

And the song continues...

Bridge:
<img src="https://via.placeholder.com/350x175/45B7D1/FFFFFF?text=Artist+Photo" alt="Artist Photo" title="Photo of the Artist" />

Final Chorus:
This is the final chorus
The song is ending now
```

## Features Supported:

1. **HTML Image Tags**: `<img src="..." alt="..." title="..." />`
2. **Image Attributes**: 
   - `src` - Image URL (validated for safety)
   - `alt` - Alternative text for accessibility  
   - `title` - Tooltip text
   - `width` and `height` (optional, with validation)

3. **Safety Features**:
   - URL validation (only HTTP/HTTPS and relative paths)
   - HTML sanitization to prevent XSS
   - Automatic lazy loading
   - Error handling for broken images

4. **User Experience**:
   - Click to open images in full screen modal
   - Responsive sizing
   - Hover effects
   - Loading states
   - Dark mode support

5. **Search Integration**:
   - HTML tags are stripped when searching
   - Images don't interfere with text search
   - Alt text is included in search content

## Usage Instructions:

1. Add `<img>` tags directly in your `.l` lyrics files
2. Images will be displayed inline with the lyrics
3. Click any image to view it in full screen
4. Search functionality works normally, ignoring HTML tags