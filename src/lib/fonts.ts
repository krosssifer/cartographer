import fonts from '../assets/fonts/embedded.json';

const { 'golos-cyrillic': golosCyrillic, 'golos-latin': golosLatin, 'cormorant-cyrillic': cormorantCyrillic, 'cormorant-latin': cormorantLatin } = fonts;

const style = document.createElement('style');
style.dataset.embeddedFonts = 'battlemap';
style.textContent = `
@font-face { font-family: 'Golos Text'; src: url(${golosCyrillic}) format('woff2'); font-weight: 400 700; font-display: swap; unicode-range: U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116; }
@font-face { font-family: 'Golos Text'; src: url(${golosLatin}) format('woff2'); font-weight: 400 700; font-display: swap; unicode-range: U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD; }
@font-face { font-family: 'Cormorant Garamond'; src: url(${cormorantCyrillic}) format('woff2'); font-weight: 300 700; font-display: swap; unicode-range: U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116; }
@font-face { font-family: 'Cormorant Garamond'; src: url(${cormorantLatin}) format('woff2'); font-weight: 300 700; font-display: swap; unicode-range: U+0000-00FF,U+2000-206F; }
`;
document.head.appendChild(style);
