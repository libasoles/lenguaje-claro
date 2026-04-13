// 📋 Script para ejecutar en la consola de DevTools de Google Docs
// Copia y pega esto en la consola (F12) dentro de un documento de Google Docs

console.log('🔍 Iniciando debug de estructura DOM de Google Docs...\n');

// 1. Diagnóstico básico
console.log('📊 1. Búsqueda de selectores clásicos (viejos):');
console.log(`   .kix-paragraphrenderer: ${document.querySelectorAll('.kix-paragraphrenderer').length}`);
console.log(`   .kix-page: ${document.querySelectorAll('.kix-page').length}`);
console.log(`   [data-paragraph-id]: ${document.querySelectorAll('[data-paragraph-id]').length}`);
console.log(`   .kix-appview: ${document.querySelectorAll('.kix-appview').length}`);

// 2. Búsqueda de nuevos selectores
console.log('\n📊 2. Búsqueda de selectores nuevos:');
console.log(`   [role="list"].docos-stream-view: ${document.querySelectorAll('[role="list"].docos-stream-view').length}`);
console.log(`   [role="main"]: ${document.querySelectorAll('[role="main"]').length}`);
console.log(`   [role="textbox"]: ${document.querySelectorAll('[role="textbox"]').length}`);

// 3. Explorar clases disponibles
console.log('\n📊 3. Clases encontradas (primeras 30):');
const allClasses = new Set();
document.querySelectorAll('[class]').forEach(el => {
  Array.from(el.classList).slice(0, 3).forEach(cls => {
    if (cls.length < 40) allClasses.add(cls);
  });
});
Array.from(allClasses).slice(0, 30).forEach(cls => console.log(`   - ${cls}`));

// 4. Explorar estructura del body
console.log('\n📊 4. Estructura principal del document.body:');
const bodyChildren = Array.from(document.body.children).slice(0, 15);
bodyChildren.forEach((child, i) => {
  console.log(`   ${i}: <${child.tagName}> id="${child.id}" class="${child.className.substring(0, 50)}"`);
});

// 5. Buscar el contenedor que tiene el texto visible
console.log('\n📝 5. Buscando contenedor principal con texto:');
const textContainers = document.querySelectorAll('[role="list"], [role="main"], [role="document"]');
let maxText = '';
let maxEl = null;
textContainers.forEach(el => {
  const text = el.innerText || '';
  if (text.length > maxText.length) {
    maxText = text;
    maxEl = el;
  }
});

if (maxEl) {
  console.log(`   ✅ Encontrado: <${maxEl.tagName}>`);
  console.log(`   - ID: "${maxEl.id}"`);
  console.log(`   - Clases: "${maxEl.className}"`);
  console.log(`   - role: "${maxEl.getAttribute('role')}"`);
  console.log(`   - Texto (primeros 150 chars): "${maxText.substring(0, 150)}"`);
  console.log(`   - Hijos directos: ${maxEl.children.length}`);

  // Analizar hijos
  console.log('\n   Primeros 5 hijos:');
  Array.from(maxEl.children).slice(0, 5).forEach((child, i) => {
    console.log(`     ${i}: <${child.tagName}> role="${child.getAttribute('role')}" data-id="${child.getAttribute('data-id')}"`);
    console.log(`        clase: "${child.className.substring(0, 60)}"`);
    console.log(`        texto: "${(child.innerText || '').substring(0, 60)}"`);
  });
}

// 6. Intentar extraer párrafos/elementos de contenido
console.log('\n📝 6. Buscando párrafos/bloques de contenido:');
const possibleParagraphs = document.querySelectorAll(
  '[data-block-id], [data-content-id], [role="listitem"], ' +
  'div[role="paragraph"], div[role="document"], ' +
  'p, h1, h2, h3, h4, h5, h6'
);
console.log(`   Elementos encontrados: ${possibleParagraphs.length}`);

if (possibleParagraphs.length > 0 && possibleParagraphs.length < 100) {
  console.log('   Primeros 5 con texto:');
  let count = 0;
  possibleParagraphs.forEach(el => {
    if (count >= 5) return;
    const text = (el.innerText || '').trim();
    if (text.length > 0) {
      console.log(`     <${el.tagName}> "${text.substring(0, 50)}"`);
      count++;
    }
  });
}

// 7. Método directo: buscar nodos de texto
console.log('\n📝 7. Extrayendo texto vía TreeWalker:');
const walker = document.createTreeWalker(
  document.body,
  NodeFilter.SHOW_TEXT,
  null
);
let textCount = 0;
let totalLength = 0;
const sampleTexts = [];
let node;
while (node = walker.nextNode()) {
  const text = node.textContent.trim();
  if (text.length > 3) {
    textCount++;
    totalLength += text.length;
    if (sampleTexts.length < 3) {
      sampleTexts.push(text.substring(0, 60));
    }
  }
}
console.log(`   Nodos de texto encontrados: ${textCount}`);
console.log(`   Longitud total: ${totalLength} caracteres`);
console.log(`   Ejemplos:`);
sampleTexts.forEach((text, i) => console.log(`     ${i + 1}: "${text}"`));

// 8. Resumen y recomendación
console.log('\n\n🎯 RESUMEN Y RECOMENDACIONES:');
console.log('================================\n');

if (maxEl) {
  console.log(`✅ Contenedor principal identificado:`);
  console.log(`   Selector recomendado: ${maxEl.className ? `[role="${maxEl.getAttribute('role')}"].${maxEl.className.split(' ')[0]}` : `[role="${maxEl.getAttribute('role')}"]`}`);
  console.log(`\n   Para DocsReader.leerTextoCompleto(), usa:`);
  console.log(`   const container = document.querySelector('[role="list"].docos-stream-view');`);
  console.log(`   return container ? container.innerText : '';`);
} else {
  console.log(`⚠️ No se encontró contenedor principal claro.`);
  console.log(`   Pero se encontraron ${textCount} nodos de texto.`);
}

console.log('\n\n📋 PRÓXIMOS PASOS:');
console.log('1. Abre este archivo en Google Docs');
console.log('2. Abre DevTools (F12 o Cmd+Option+I)');
console.log('3. Ve a la pestaña Console');
console.log('4. Copia el contenido de console-debug.js');
console.log('5. Pégalo en la consola y presiona Enter');
console.log('6. Revisa los resultados arriba 👆\n');
