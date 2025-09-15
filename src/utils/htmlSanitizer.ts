/**
 * HTML sanitization utilities for lyrics content
 * Provides safe HTML processing while preserving formatting and images
 */

// Allowed HTML tags for lyrics content
const ALLOWED_TAGS = ['br', 'img', 'b', 'i', 'strong', 'em', 'u', 'p', 'div', 'span']

// Allowed attributes for each tag
const ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  img: ['src', 'alt', 'title', 'width', 'height'],
  a: ['href', 'title', 'target'],
  p: ['class'],
  div: ['class'],
  span: ['class']
}

/**
 * Sanitize HTML content while preserving safe tags and attributes
 * @param html - Raw HTML content
 * @returns Sanitized HTML content
 */
export function sanitizeHtml(html: string): string {
  // Create a temporary DOM element to parse HTML
  const tempDiv = document.createElement('div')
  tempDiv.innerHTML = html
  
  // Process all elements recursively
  processElement(tempDiv)
  
  return tempDiv.innerHTML
}

/**
 * Process an element and its children, removing unsafe content
 * @param element - DOM element to process
 */
function processElement(element: Element): void {
  const children = Array.from(element.children)
  
  for (const child of children) {
    const tagName = child.tagName.toLowerCase()
    
    if (!ALLOWED_TAGS.includes(tagName)) {
      // Remove disallowed tags but keep their text content
      const textContent = child.textContent || ''
      const textNode = document.createTextNode(textContent)
      child.parentNode?.replaceChild(textNode, child)
    } else {
      // Process allowed tags - sanitize attributes
      sanitizeAttributes(child, tagName)
      
      // Recursively process children
      processElement(child)
    }
  }
}

/**
 * Sanitize attributes of an element
 * @param element - DOM element
 * @param tagName - Tag name in lowercase
 */
function sanitizeAttributes(element: Element, tagName: string): void {
  const allowedAttrs = ALLOWED_ATTRIBUTES[tagName] || []
  const attrs = Array.from(element.attributes)
  
  for (const attr of attrs) {
    if (!allowedAttrs.includes(attr.name)) {
      element.removeAttribute(attr.name)
    } else {
      // Sanitize attribute values
      const sanitizedValue = sanitizeAttributeValue(attr.name, attr.value)
      if (sanitizedValue !== attr.value) {
        element.setAttribute(attr.name, sanitizedValue)
      }
    }
  }
}

/**
 * Sanitize attribute values
 * @param attrName - Attribute name
 * @param value - Attribute value
 * @returns Sanitized value
 */
function sanitizeAttributeValue(attrName: string, value: string): string {
  switch (attrName) {
    case 'src':
    case 'href':
      // Allow only HTTP(S) URLs and relative paths, no javascript: or other protocols
      if (value.match(/^(https?:\/\/|\/|\.\/|\.\.\/)/i)) {
        return value
      }
      return '' // Remove invalid URLs
      
    case 'target':
      // Only allow safe target values
      return ['_blank', '_self', '_parent', '_top'].includes(value) ? value : '_self'
      
    default:
      // Escape HTML in other attribute values
      return escapeHtml(value)
  }
}

/**
 * Escape HTML special characters
 * @param text - Text to escape
 * @returns Escaped text
 */
export function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

/**
 * Process lyrics content with image support
 * @param lyricsText - Raw lyrics text
 * @returns Processed HTML content
 */
export function processLyricsContent(lyricsText: string): string {
  // Replace line breaks with <br> tags for proper HTML rendering
  let processed = lyricsText.replace(/\n/g, '<br>')
  
  // Process <img> tags to ensure they have proper attributes and styling
  processed = processed.replace(/<img([^>]*)>/gi, (match, attributes) => {
    // Extract src attribute
    const srcMatch = attributes.match(/src\s*=\s*["']([^"']+)["']/i)
    if (!srcMatch) return '' // Remove img tags without src
    
    const src = srcMatch[1]
    
    // Validate URL
    if (!src.match(/^(https?:\/\/|\/|\.\/|\.\.\/)/i)) {
      return '' // Remove invalid URLs
    }
    
    // Extract alt attribute if exists
    const altMatch = attributes.match(/alt\s*=\s*["']([^"']*)["']/i)
    const alt = altMatch ? altMatch[1] : 'Lyrics image'
    
    // Extract title attribute if exists
    const titleMatch = attributes.match(/title\s*=\s*["']([^"']*)["']/i)
    const title = titleMatch ? titleMatch[1] : alt
    
    // Extract width and height if they exist
    const widthMatch = attributes.match(/width\s*=\s*["']([^"']*)["']/i)
    const heightMatch = attributes.match(/height\s*=\s*["']([^"']*)["']/i)
    
    // Build safe img tag with proper classes and attributes
    let imgTag = `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" title="${escapeHtml(title)}" class="lyrics-image" loading="lazy"`
    
    if (widthMatch && widthMatch[1].match(/^\d+%?$/)) {
      imgTag += ` width="${escapeHtml(widthMatch[1])}"`
    }
    if (heightMatch && heightMatch[1].match(/^\d+%?$/)) {
      imgTag += ` height="${escapeHtml(heightMatch[1])}"`
    }
    
    imgTag += ' />'
    return imgTag
  })
  
  // Sanitize the final HTML
  return sanitizeHtml(processed)
}

/**
 * Strip HTML tags from text for search purposes
 * @param html - HTML content
 * @returns Plain text content
 */
export function stripHtmlTags(html: string): string {
  const tempDiv = document.createElement('div')
  tempDiv.innerHTML = html
  return tempDiv.textContent || tempDiv.innerText || ''
}

/**
 * Check if a string contains HTML tags
 * @param text - Text to check
 * @returns True if contains HTML tags
 */
export function containsHtml(text: string): boolean {
  return /<[^>]*>/g.test(text)
}