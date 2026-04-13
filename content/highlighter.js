const DocsHighlighter = {
  highlights: new Map(), // Almacena referencias a los elementos de highlight

  // Limpia todos los highlights previos
  limpiar() {
    document.querySelectorAll('.docs-reviewer-match').forEach(el => {
      // Extraer el texto y reemplazar el span con un nodo de texto
      const parent = el.parentNode;
      const text = el.textContent;
      const textNode = document.createTextNode(text);
      parent.replaceChild(textNode, el);
    });
    this.highlights.clear();
  },

  // Aplica highlights basados en los matches detectados
  aplicarHighlights(allMatches) {
    this.limpiar();

    const paragrafos = DocsReader.leerParagrafos();

    allMatches.forEach(match => {
      const textoParafo = DocsReader.leerTextoCompleto();
      let textoAcumulado = 0;

      for (const para of paragrafos) {
        const textoParrafo = para.texto;
        const textoParrafoLen = textoParrafo.length;

        // Verificar si el match está en este párrafo
        if (match.inicio >= textoAcumulado && match.inicio < textoAcumulado + textoParrafoLen + 1) {
          // Calcular posición dentro del párrafo
          const inicioEnParrafo = match.inicio - textoAcumulado;
          const finEnParrafo = match.fin - textoAcumulado;

          // Obtener la regla para el color
          const regla = window.docsReviewerRules.find(r => r.id === match.regla);
          const color = regla ? regla.color : '#e74c3c';

          try {
            // Crear el span con el texto del match
            const spanMatch = document.createElement('span');
            spanMatch.className = 'docs-reviewer-match';
            spanMatch.textContent = match.textoOriginal;
            spanMatch.setAttribute('data-match-id', match.id);
            spanMatch.setAttribute('data-regla', match.regla);
            spanMatch.setAttribute('data-sugerencia', match.sugerencia);
            spanMatch.setAttribute('data-descripcion', match.descripcion);
            spanMatch.style.borderBottom = `3px wavy ${color}`;
            spanMatch.style.cursor = 'pointer';

            // Usar Range API para seleccionar exactamente el rango del match
            const range = document.createRange();
            const nodeIterator = document.createNodeIterator(
              para.elemento,
              NodeFilter.SHOW_TEXT,
              null
            );

            let currentNode;
            let currentPos = 0;
            let startNode = null;
            let startOffset = 0;
            let endNode = null;
            let endOffset = 0;

            while (currentNode = nodeIterator.nextNode()) {
              const nodeLen = currentNode.length;
              const nodeStart = currentPos;
              const nodeEnd = currentPos + nodeLen;

              if (!startNode && nodeEnd > inicioEnParrafo) {
                startNode = currentNode;
                startOffset = inicioEnParrafo - nodeStart;
              }

              if (nodeStart < finEnParrafo) {
                endNode = currentNode;
                endOffset = Math.min(finEnParrafo - nodeStart, nodeLen);
              }

              currentPos += nodeLen;
            }

            if (startNode && endNode) {
              range.setStart(startNode, startOffset);
              range.setEnd(endNode, endOffset);

              // Envolver el rango con el span
              try {
                range.surroundContents(spanMatch);
              } catch (e) {
                // Si surroundContents falla (rango cruza límites de elemento),
                // usar un enfoque alternativo
                const contents = range.extractContents();
                spanMatch.appendChild(contents);
                range.insertNode(spanMatch);
              }

              this.highlights.set(match.id, spanMatch);
            }
          } catch (e) {
            console.error('Error al inyectar highlight:', e);
          }

          break;
        }

        textoAcumulado += textoParrafo.length + 1; // +1 por el newline
      }
    });

    // Agregar listener a los highlights para mostrar tooltips
    this.agregarListeners();
  },

  // Agrega event listeners a los highlights
  agregarListeners() {
    document.querySelectorAll('.docs-reviewer-match').forEach(span => {
      span.addEventListener('click', (e) => {
        e.stopPropagation();
        // Mostrar un evento personalizado que el panel puede escuchar
        const matchId = span.textContent;
        window.dispatchEvent(new CustomEvent('highlightClicked', { detail: { text: span.textContent } }));
      });

      span.addEventListener('mouseenter', (e) => {
        span.style.opacity = '0.7';
      });

      span.addEventListener('mouseleave', (e) => {
        span.style.opacity = '1';
      });
    });
  }
};
