// IIFE para encapsular
(function() {
    "use strict";

    // --- Estado (Simplificado) ---
    let cart = [];
    let currentModalProductId = null;
    let promoCarouselInterval = null; // Para auto-play
    let countdownInterval = null; // Para countdown

    // --- Selectores DOM (Cache) ---
    const DOM = {
        // Carrito
        cartIconBtn: document.getElementById('cart-icon-btn'),
        cartDropdown: document.getElementById('cartDropdown'),
        cartCountDisplays: document.querySelectorAll('.cart-count'),
        cartItemsContainer: document.getElementById('cartItemsContainer'),
        cartTotalDisplay: document.getElementById('cartTotal'),
        checkoutBtn: document.getElementById('checkoutBtn'),
        emptyCartMessage: document.querySelector('#cartDropdown .empty-cart-message'),
        // Modal
        modalOverlay: document.getElementById('productModalOverlay'),
        modalContent: document.querySelector('.modal-content'), // Para animación
        modalCloseBtn: document.querySelector('.modal-close-btn'), // Targeted for close functionality
        modalTitle: document.getElementById('modalTitle'),
        modalPrice: document.getElementById('modalPrice'),
        modalOldPrice: document.getElementById('modalOldPrice'),
        modalDescription: document.getElementById('modalDescription'),
        modalMainImg: document.getElementById('modalMainImg'),
        modalThumbnails: document.getElementById('modalThumbnails'),
        modalSpecs: document.getElementById('modalSpecs'),
        modalQuantityInput: document.getElementById('modalQuantityInput'),
        modalDecreaseQtyBtn: document.querySelector('.modal-content .decrease-qty-btn'),
        modalIncreaseQtyBtn: document.querySelector('.modal-content .increase-qty-btn'),
        modalAddToCartBtn: document.getElementById('modalAddToCartBtn'),
        // Productos y Filtros
        categoryNavButtons: document.querySelectorAll('#category-nav-buttons button'),
        productCards: document.querySelectorAll('.product-card'), // Cache inicial
        productGrid: document.getElementById('productos-grid'),
        ofertasGrid: document.getElementById('ofertas-grid'), // Añadido para observar
        sortOptionsSelect: document.getElementById('sortOptions'),
        productCountDisplay: document.getElementById('product-count-display'),
        // Notificaciones
        notificationContainer: document.getElementById('notification-container'),
        // Carrusel
        promoCarousel: document.getElementById('promo-carousel'),
        promoCarouselInner: document.querySelector('.promo-carousel-inner'),
        promoCarouselSlides: document.querySelectorAll('.promo-carousel-slide'),
        promoCarouselDots: document.getElementById('promo-carousel-dots'),
        promoCarouselPrevBtn: document.querySelector('.carousel-prev'),
        promoCarouselNextBtn: document.querySelector('.carousel-next'),
        // Countdown
        countdownContainer: document.getElementById('countdown-timer-container'),
        // Animaciones Scroll
        elementsToAnimate: document.querySelectorAll('.animate-on-scroll, .section-title'), // Elementos a animar al hacer scroll
        // Header
        mainHeader: document.querySelector('.main-header'),
        // Search
        searchForm: document.getElementById('searchForm'),
        searchInput: document.getElementById('searchInputHeader'),
        searchCategorySelect: document.getElementById('searchCategoryHeader')
    };

    // --- Utilidades ---
    const Utils = {
        formatCurrency: (amount) => {
             const numAmount = Number(amount);
             return `S/${isNaN(numAmount) ? '0.00' : numAmount.toFixed(2)}`;
         },
        addClass: (el, cls) => el?.classList.add(cls),
        removeClass: (el, cls) => el?.classList.remove(cls),
        toggleClass: (el, cls, force) => el?.classList.toggle(cls, force),
        hasClass: (el, cls) => el?.classList.contains(cls),
        show: (el) => { if(el) el.style.display = ''; Utils.removeClass(el, 'hidden');},
        hide: (el) => { if(el) { el.style.display = 'none'; Utils.addClass(el, 'hidden'); }},
        // Throttle para eventos frecuentes como scroll o input
        throttle: (func, limit) => {
            let inThrottle;
            return function() {
                const args = arguments;
                const context = this;
                if (!inThrottle) {
                    func.apply(context, args);
                    inThrottle = true;
                    setTimeout(() => inThrottle = false, limit);
                }
            }
        }
    };

    // --- Notificaciones ---
    const Notify = {
        show: (message, duration = 3000) => {
            const container = DOM.notificationContainer;
            if (!container) return;
            const el = document.createElement('div');
            el.className = 'notification';
            el.textContent = message;
            el.setAttribute('role', 'alert');
            container.appendChild(el);
            // Forzar reflow para que la transición inicial funcione
            el.offsetHeight;
            requestAnimationFrame(() => {
                Utils.addClass(el, 'visible');
            });

            setTimeout(() => {
                Utils.removeClass(el, 'visible');
                // Esperar a que termine la transición de salida antes de remover
                el.addEventListener('transitionend', () => el.remove(), { once: true });
                // Fallback removal in case transitionend doesn't fire
                setTimeout(() => el.remove(), duration + 500);
            }, duration);
        }
    };

    // --- LocalStorage ---
    const Store = {
        get: (key, defaultVal = null) => {
            try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : defaultVal; }
            catch (e) { console.error(`LS Get Error [${key}]:`, e); return defaultVal; }
        },
        set: (key, value) => {
            try { localStorage.setItem(key, JSON.stringify(value)); }
            catch (e) { console.error(`LS Set Error [${key}]:`, e); }
        }
    };

    // --- Carrito Lógica ---
    const Cart = {
        init: () => {
            cart = Store.get('shoppingCart', []);
            Cart.render();
            DOM.cartIconBtn?.addEventListener('click', Cart.toggleDropdown);
            document.addEventListener('click', (e) => {
                if (Utils.hasClass(DOM.cartDropdown, 'visible') &&
                    !DOM.cartIconBtn?.contains(e.target) &&
                    !DOM.cartDropdown?.contains(e.target)) {
                    Cart.closeDropdown();
                }
             });
             document.addEventListener('keydown', (e) => {
                 if (e.key === 'Escape' && Utils.hasClass(DOM.cartDropdown, 'visible')) {
                     Cart.closeDropdown();
                 }
             });
             // Event delegation for removing items directly from cart dropdown
             DOM.cartItemsContainer?.addEventListener('click', (e) => {
                if (e.target.classList.contains('cart-item-remove')) {
                    const productId = e.target.dataset.id;
                    if (productId) {
                        Cart.remove(productId);
                    }
                }
            });
        },
        save: () => Store.set('shoppingCart', cart),
        add: (productData, quantity) => {
            if (!productData || !productData.id || !productData.title || productData.price == null || quantity <= 0) {
                 console.error("Datos inválidos para añadir al carrito:", productData); Notify.show("Error al añadir producto."); return;
             }
            const existing = cart.find(item => item.id === productData.id);
            if (existing) { existing.quantity += quantity; }
            else {
                cart.push({
                    id: productData.id, title: productData.title, price: productData.price,
                    img: productData.img || productData.thumbnails?.[0] || '/api/placeholder/80/80',
                    quantity: quantity
                });
            }
            Notify.show(`${quantity} x ${productData.title} añadido`);
            Cart.save(); Cart.render(true); // Indicar que hubo actualización para animación
            Cart.openDropdown();
            setTimeout(Cart.closeDropdown, 2500);
        },
        remove: (productId) => {
            const index = cart.findIndex(item => item.id === productId);
            if (index > -1) {
                Notify.show(`${cart[index].title} eliminado`);
                cart.splice(index, 1); Cart.save(); Cart.render(true); // Indicar que hubo actualización
            }
        },
        render: (updated = false) => {
            const count = cart.reduce((sum, item) => sum + item.quantity, 0);
            const total = cart.reduce((sum, item) => sum + (Number(item.price) * item.quantity), 0);

            DOM.cartCountDisplays.forEach(el => {
                if(el) {
                    el.textContent = count;
                    if (updated && count > 0) { // Animación solo si se actualizó y no está vacío
                        Utils.addClass(el, 'updated');
                        setTimeout(() => Utils.removeClass(el, 'updated'), 500); // Duración de la animación pulse
                    }
                }
            });
            if (DOM.cartTotalDisplay) DOM.cartTotalDisplay.textContent = Utils.formatCurrency(total);
            if (DOM.checkoutBtn) DOM.checkoutBtn.disabled = count === 0;
            if (DOM.emptyCartMessage) DOM.emptyCartMessage.style.display = count === 0 ? 'block' : 'none';
            if (!DOM.cartItemsContainer) return;

            DOM.cartItemsContainer.innerHTML = '';
            if (count > 0) {
                cart.forEach(item => {
                    const itemEl = document.createElement('div'); itemEl.className = 'cart-item';
                    itemEl.innerHTML = `
                        <img src="${item.img || '/api/placeholder/80/80'}" alt="" class="cart-item-img">
                        <div class="cart-item-details"> <div class="cart-item-title">${item.title}</div> <div class="cart-item-price">${Utils.formatCurrency(item.price)}</div> <div class="cart-item-quantity">Cant: ${item.quantity}</div> </div>
                        <div class="cart-item-subtotal">${Utils.formatCurrency(Number(item.price) * item.quantity)}</div>
                        <button class="cart-item-remove" data-id="${item.id}" aria-label="Eliminar ${item.title}">×</button>`;
                    // Event listener moved to Cart.init using event delegation
                    DOM.cartItemsContainer.appendChild(itemEl);
                });
            }
        },
        toggleDropdown: () => {
            const isVisible = Utils.hasClass(DOM.cartDropdown, 'visible');
            Utils.toggleClass(DOM.cartDropdown, 'visible');
            DOM.cartIconBtn?.setAttribute('aria-expanded', String(!isVisible));
        },
        openDropdown: () => { Utils.addClass(DOM.cartDropdown, 'visible'); DOM.cartIconBtn?.setAttribute('aria-expanded', 'true'); },
        closeDropdown: () => { if (Utils.hasClass(DOM.cartDropdown, 'visible')) { Utils.removeClass(DOM.cartDropdown, 'visible'); DOM.cartIconBtn?.setAttribute('aria-expanded', 'false'); } }
    };

    // --- Modal Lógica ---
    const Modal = {
        init: () => {
            // Ensure button exists before adding listener
            if (DOM.modalCloseBtn) {
                DOM.modalCloseBtn.addEventListener('click', Modal.close);
            } else {
                console.warn("Modal close button not found.");
            }
            DOM.modalOverlay?.addEventListener('click', (e) => { if (e.target === DOM.modalOverlay) Modal.close(); });
            DOM.modalDecreaseQtyBtn?.addEventListener('click', () => Modal.updateQuantity(-1));
            DOM.modalIncreaseQtyBtn?.addEventListener('click', () => Modal.updateQuantity(1));
            DOM.modalAddToCartBtn?.addEventListener('click', Modal.addToCart);
            document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && Utils.hasClass(DOM.modalOverlay, 'visible')) { Modal.close(); } });
        },
        getProductData: (productId) => {
             const card = document.querySelector(`.product-card[data-product-id="${productId}"]`);
             const script = card?.querySelector('.product-data');
             try { return script ? JSON.parse(script.textContent) : null; }
             catch(e) { console.error("Error parsing product data", productId, e); return null; }
        },
        open: (productId) => {
            const data = Modal.getProductData(productId);
            if (!data || !DOM.modalOverlay || !DOM.modalContent) { Notify.show("Error al cargar producto."); return; }

            currentModalProductId = data.id;
            // Resetear contenido antes de mostrar nuevo
            DOM.modalTitle.textContent = '';
            DOM.modalPrice.textContent = '';
            DOM.modalOldPrice.textContent = '';
            DOM.modalDescription.textContent = '';
            DOM.modalMainImg.src = '/api/placeholder/400/320?text=Cargando...';
            DOM.modalSpecs.innerHTML = '';
            DOM.modalThumbnails.innerHTML = '';

            // Llenar con datos
            requestAnimationFrame(() => {
                DOM.modalTitle.textContent = data.title;
                DOM.modalPrice.textContent = Utils.formatCurrency(data.price);
                Utils.toggleClass(DOM.modalOldPrice, 'hidden', !data.oldPrice);
                if(data.oldPrice) DOM.modalOldPrice.textContent = Utils.formatCurrency(data.oldPrice);
                DOM.modalDescription.textContent = data.description || '';
                DOM.modalMainImg.src = data.img || '/api/placeholder/400/320?text=Imagen+no+disp.';
                DOM.modalMainImg.alt = `Imagen de ${data.title}`;

                // Specs
                if (data.specs && Array.isArray(data.specs) && data.specs.length > 0) {
                    DOM.modalSpecs.innerHTML = '<ul>' + data.specs.map(spec => {
                        const parts = typeof spec === 'string' ? spec.split(':') : [];
                        const label = parts.length > 1 ? `<strong>${parts[0].trim()}:</strong>` : '';
                        const value = parts.length > 1 ? parts.slice(1).join(':').trim() : spec;
                        return `<li class="spec-item">${label} ${value}</li>`;
                     }).join('') + '</ul>';
                } else { DOM.modalSpecs.innerHTML = '<p>Especificaciones no disponibles.</p>'; }

                // Thumbnails
                const thumbs = data.thumbnails && data.thumbnails.length > 0 ? data.thumbnails : (data.img ? [data.img] : []);
                DOM.modalThumbnails.innerHTML = ''; // Clear previous thumbs
                thumbs.forEach((thumbSrc, index) => {
                    if(!thumbSrc) return;
                    const thumbBtn = document.createElement('button');
                    const thumbUrl = thumbSrc.includes('/api/placeholder/') ? thumbSrc.replace(/(\d+)\/(\d+)/, '80/80') : thumbSrc;
                    thumbBtn.innerHTML = `<img src="${thumbUrl}" alt="Vista ${index + 1}">`;
                    if (index === 0) Utils.addClass(thumbBtn, 'active');
                    thumbBtn.addEventListener('click', () => Modal.changeImage(thumbBtn, thumbSrc));
                    const li = document.createElement('li'); li.className = 'modal-thumbnail'; li.appendChild(thumbBtn);
                    DOM.modalThumbnails.appendChild(li);
                });

                if(DOM.modalQuantityInput) DOM.modalQuantityInput.value = '1';
                Modal.resetAddToCartButton();

                // Mostrar modal con animación
                Utils.addClass(DOM.modalOverlay, 'visible');
                document.body.style.overflow = 'auto';
                DOM.modalOverlay.setAttribute('aria-hidden', 'false');
                DOM.modalCloseBtn?.focus();
                // Add animation class after display is set
                Utils.removeClass(DOM.modalContent, 'animated zoomOut faster'); // Remove exit animation if present
                Utils.addClass(DOM.modalContent, 'animated zoomIn faster');
            });
        },
        close: () => { // This function handles visibility and animations for closing
            if (!DOM.modalOverlay || !Utils.hasClass(DOM.modalOverlay, 'visible')) return;

            // Function to cleanup after animation/transition
            const cleanup = () => {
                Utils.removeClass(DOM.modalOverlay, 'visible');
                Utils.removeClass(DOM.modalContent, 'animated zoomOut faster'); // Clean up animation class
                document.body.style.overflow = '';
                currentModalProductId = null;
                DOM.modalOverlay.setAttribute('aria-hidden', 'true');
                DOM.modalOverlay.removeEventListener('transitionend', transitionHandler); // Remove listener
                clearTimeout(fallbackTimeout); // Clear fallback timeout
            };

            // Listener for transition end
            const transitionHandler = (e) => {
                // Ensure the transition is on the overlay opacity
                if (e.propertyName === 'opacity' && e.target === DOM.modalOverlay) {
                    cleanup();
                }
            };

            // Add listener only if overlay exists
            DOM.modalOverlay.addEventListener('transitionend', transitionHandler, { once: true });

            // Fallback timeout in case transitionend doesn't fire reliably
            const fallbackTimeout = setTimeout(cleanup, 500); // Match or slightly exceed CSS transition duration

            // Trigger the opacity transition on the overlay
            // (Assuming the 'visible' class controls opacity)
            Utils.removeClass(DOM.modalOverlay, 'visible'); // This should start the overlay fade out
        },
        changeImage: (thumbBtn, imgSrc) => {
             if (!DOM.modalMainImg || !DOM.modalThumbnails) return;
             const mainImgUrl = imgSrc.includes('/api/placeholder/') ? imgSrc.replace(/(\d+)\/(\d+)/, '400/320') : imgSrc;
             // Añadir clase loading y cambiar imagen después de un pequeño delay
             Utils.addClass(DOM.modalMainImg, 'loading');
             setTimeout(() => {
                 DOM.modalMainImg.src = mainImgUrl;
                 DOM.modalMainImg.onload = () => Utils.removeClass(DOM.modalMainImg, 'loading'); // Quitar loading al cargar
                 DOM.modalMainImg.onerror = () => Utils.removeClass(DOM.modalMainImg, 'loading'); // Also remove on error
             }, 100); // Pequeño delay para que se vea el efecto loading
             DOM.modalThumbnails.querySelectorAll('button').forEach(t => Utils.removeClass(t, 'active'));
             Utils.addClass(thumbBtn, 'active');
        },
        updateQuantity: (change) => {
             if (!DOM.modalQuantityInput) return;
             let qty = parseInt(DOM.modalQuantityInput.value) || 1;
             qty = Math.max(1, qty + change);
             DOM.modalQuantityInput.value = qty;
        },
        resetAddToCartButton: () => {
             if(!DOM.modalAddToCartBtn) return;
             Utils.removeClass(DOM.modalAddToCartBtn, 'added');
             DOM.modalAddToCartBtn.textContent = 'AÑADIR AL CARRITO';
             DOM.modalAddToCartBtn.disabled = false;
         },
        addToCart: () => {
             if (!currentModalProductId || !DOM.modalQuantityInput || !DOM.modalAddToCartBtn) return;
             const data = Modal.getProductData(currentModalProductId);
             if (data) {
                 const quantity = parseInt(DOM.modalQuantityInput.value);
                 Cart.add(data, quantity);
                 // Animación botón añadido
                 Utils.addClass(DOM.modalAddToCartBtn, 'added');
                 DOM.modalAddToCartBtn.textContent = 'AÑADIDO ✓';
                 DOM.modalAddToCartBtn.disabled = true;
                 setTimeout(() => {
                     // Check if modal is still open and button state hasn't changed
                     if (Utils.hasClass(DOM.modalOverlay,'visible') && currentModalProductId === data.id && Utils.hasClass(DOM.modalAddToCartBtn, 'added')) {
                        Modal.resetAddToCartButton();
                     }
                 }, 1500);
              }
        }
    };

    // --- Filtros, Ordenamiento y Búsqueda ---
    const Products = {
        init: () => {
             const categoryNavContainer = document.getElementById('category-nav-buttons');
             if (categoryNavContainer) {
                categoryNavContainer.addEventListener('click', (e) => {
                     if (e.target.tagName === 'BUTTON' && e.target.dataset.category) {
                         Products.setActiveCategoryButton(e.target);
                         Products.updateProductVisibility(); // Use combined update function
                     }
                 });
             }
             // Event delegation for product card actions
             document.body.addEventListener('click', (e) => {
                const viewBtn = e.target.closest('.view-details-btn');
                const addBtn = e.target.closest('.add-cart-btn');
                const reserveBtn = e.target.closest('.reserve-btn');

                 if (viewBtn) {
                     e.preventDefault();
                     const card = viewBtn.closest('.product-card');
                     if (card && card.dataset.productId) Modal.open(card.dataset.productId);
                 } else if (addBtn) {
                     e.preventDefault(); // Prevent default if it's inside a link
                     const card = addBtn.closest('.product-card');
                     const productId = card?.dataset.productId;
                     const data = Modal.getProductData(productId);
                     if (data) {
                         Cart.add(data, 1);
                         // Animación botón añadido en tarjeta
                         Utils.addClass(addBtn,'added'); addBtn.textContent = '✓'; addBtn.disabled = true;
                         setTimeout(() => {
                             const currentBtn = document.querySelector(`.add-cart-btn[data-product-id="${productId}"]`);
                             if (currentBtn && Utils.hasClass(currentBtn, 'added')) {
                                 Utils.removeClass(currentBtn,'added'); currentBtn.textContent = 'Añadir'; currentBtn.disabled = false;
                             }
                         }, 1500);
                     }
                 } else if (reserveBtn) {
                    e.preventDefault();
                    Notify.show("Contacta con nosotros para consultar este servicio.");
                    // Example: Redirect or open contact modal
                    // window.location.href = '/contacto';
                 }
             });

             DOM.sortOptionsSelect?.addEventListener('change', Products.updateProductVisibility); // Use combined update function

             // --- Search Event Listeners ---
             if (DOM.searchForm) {
                 DOM.searchForm.addEventListener('submit', (e) => {
                     e.preventDefault(); // Prevent page reload
                     Products.updateProductVisibility();
                      DOM.searchInput?.blur(); // Optional: remove focus from input after submit
                 });
             }
             if (DOM.searchInput) {
                // Use throttle to avoid filtering on every single key press
                 DOM.searchInput.addEventListener('input', Utils.throttle(Products.updateProductVisibility, 300));
             }
             if(DOM.searchCategorySelect) {
                 DOM.searchCategorySelect.addEventListener('change', Products.updateProductVisibility);
             }
             // --- End Search Listeners ---

             Products.updateProductVisibility(); // Initial update
        },
        setActiveCategoryButton: (clickedButton) => {
            const categoryNavContainer = document.getElementById('category-nav-buttons');
            if(categoryNavContainer) categoryNavContainer.querySelectorAll('button').forEach(btn => Utils.removeClass(btn, 'active'));
            Utils.addClass(clickedButton, 'active');
        },
        getActiveCategory: () => {
            const activeBtn = document.querySelector('#category-nav-buttons button.active');
            return activeBtn ? activeBtn.dataset.category : 'all';
        },
        // --- Combined function to handle filtering, searching, sorting and updating display ---
        updateProductVisibility: () => {
            const activeCategoryFilter = Products.getActiveCategory(); // Category from side buttons
            const searchTerm = DOM.searchInput?.value.toLowerCase().trim() || '';
            const searchCategoryFilter = DOM.searchCategorySelect?.value || 'all'; // Category from header search dropdown
            const sortBy = DOM.sortOptionsSelect?.value || 'default';

            let visibleCount = 0;
            const gridsToUpdate = [DOM.ofertasGrid, DOM.productGrid].filter(Boolean); // Process both grids if they exist

            gridsToUpdate.forEach(grid => {
                const cards = Array.from(grid.querySelectorAll('.product-card'));

                // 1. Filter and Search Pass
                const filteredCards = cards.map(card => {
                    const cardCategories = card.dataset.category ? card.dataset.category.split(' ') : [];
                    const cardData = Modal.getProductData(card.dataset.productId) || {}; // Get data for searching text
                    const cardBrand = card.dataset.brand?.toLowerCase() || '';

                    // Apply category filter (from side buttons)
                    const categoryMatch = activeCategoryFilter === 'all' || cardCategories.includes(activeCategoryFilter);

                    // Apply search term filter
                    let searchMatch = true;
                    if (searchTerm) {
                        const searchableText = [
                            cardData.title,
                            cardData.description,
                            cardBrand, // Include brand from data attribute
                            cardCategories.join(' ') // Include categories from data attribute
                        ].join(' ').toLowerCase();
                        searchMatch = searchableText.includes(searchTerm);
                    }

                    // Apply search category filter (from header dropdown)
                    const searchCategoryMatch = searchCategoryFilter === 'all' || cardCategories.includes(searchCategoryFilter);

                    // Determine visibility based on ALL active filters
                    const isVisible = categoryMatch && searchMatch && searchCategoryMatch;
                    card.dataset.visible = String(isVisible); // Store visibility state on the card
                    return card;
                });

                // 2. Sort Pass (Sort all cards based on visibility status first, then by criteria)
                 filteredCards.sort((a, b) => {
                    const visibleA = a.dataset.visible === 'true';
                    const visibleB = b.dataset.visible === 'true';

                    // Prioritize visible items
                    if (visibleA && !visibleB) return -1;
                    if (!visibleA && visibleB) return 1;

                    // If both have same visibility status, then sort by chosen criteria
                    const dataA = Modal.getProductData(a.dataset.productId) || {};
                    const dataB = Modal.getProductData(b.dataset.productId) || {};
                    const nameA = dataA.title || '';
                    const nameB = dataB.title || '';
                    const priceA = Number(dataA.price) || 0;
                    const priceB = Number(dataB.price) || 0;

                    switch (sortBy) {
                        case 'price-asc': return priceA - priceB;
                        case 'price-desc': return priceB - priceA;
                        case 'name-asc': return nameA.localeCompare(nameB);
                        case 'name-desc': return nameB.localeCompare(nameA);
                        default: return 0; // Keep original relative order if relevance/default
                    }
                });

                // 3. Update DOM - Re-append cards in the new order and toggle visibility class
                // Using DocumentFragment for potentially better performance on large grids
                const fragment = document.createDocumentFragment();
                filteredCards.forEach(card => {
                     fragment.appendChild(card); // Append to fragment first
                     const isVisible = card.dataset.visible === 'true';
                     Utils.toggleClass(card, 'hidden', !isVisible); // Apply 'hidden' class if not visible
                     if(isVisible) {
                         visibleCount++;
                     }
                });
                grid.innerHTML = ''; // Clear grid
                grid.appendChild(fragment); // Append all sorted cards at once
            });

            // 4. Update Count Display
             if (DOM.productCountDisplay) {
                 DOM.productCountDisplay.textContent = `Mostrando ${visibleCount} producto${visibleCount !== 1 ? 's' : ''}`;
             }

             // 5. Re-observe elements for scroll animations
             Animations.observeElements();
        }
    };

    // --- Carrusel Promocional ---
    const PromoCarousel = {
        currentIndex: 0,
        init: () => {
            if (!DOM.promoCarousel || !DOM.promoCarouselInner || DOM.promoCarouselSlides.length === 0) return;

            PromoCarousel.setupDots();
            PromoCarousel.update(); // Mostrar slide inicial
            DOM.promoCarouselPrevBtn?.addEventListener('click', () => { PromoCarousel.navigate(-1); PromoCarousel.resetInterval(); });
            DOM.promoCarouselNextBtn?.addEventListener('click', () => { PromoCarousel.navigate(1); PromoCarousel.resetInterval(); });
            DOM.promoCarouselDots?.addEventListener('click', (e) => {
                if (e.target.tagName === 'BUTTON' && e.target.dataset.index) {
                    PromoCarousel.goTo(parseInt(e.target.dataset.index));
                    PromoCarousel.resetInterval();
                }
            });
            PromoCarousel.startInterval(); // Iniciar auto-play
        },
        setupDots: () => {
            if(!DOM.promoCarouselDots) return;
            DOM.promoCarouselDots.innerHTML = ''; // Clear existing dots if any
            DOM.promoCarouselSlides.forEach((_, index) => {
                const dot = document.createElement('button');
                dot.setAttribute('aria-label', `Ir a la diapositiva ${index + 1}`);
                dot.setAttribute('role', 'tab');
                dot.dataset.index = index;
                if (index === 0) Utils.addClass(dot, 'active');
                DOM.promoCarouselDots?.appendChild(dot);
            });
        },
        navigate: (direction) => {
            const totalSlides = DOM.promoCarouselSlides.length;
            if (totalSlides === 0) return;
            PromoCarousel.currentIndex = (PromoCarousel.currentIndex + direction + totalSlides) % totalSlides;
            PromoCarousel.update();
        },
        goTo: (index) => {
            if (index >= 0 && index < DOM.promoCarouselSlides.length) {
                PromoCarousel.currentIndex = index;
                PromoCarousel.update();
            }
        },
        update: () => {
            if (!DOM.promoCarouselInner || DOM.promoCarouselSlides.length === 0) return;
            // Use fade transition by toggling 'active' class
             DOM.promoCarouselSlides.forEach((slide, index) => {
                 Utils.toggleClass(slide, 'active', index === PromoCarousel.currentIndex);
            });
            // Update dots
            DOM.promoCarouselDots?.querySelectorAll('button').forEach((dot, index) => {
                 Utils.toggleClass(dot, 'active', index === PromoCarousel.currentIndex);
                 dot.setAttribute('aria-selected', String(index === PromoCarousel.currentIndex));
            });
        },
        startInterval: () => {
            clearInterval(promoCarouselInterval); // Limpiar intervalo anterior
            if (DOM.promoCarouselSlides.length > 1) { // Only start interval if more than one slide
                promoCarouselInterval = setInterval(() => PromoCarousel.navigate(1), 5000); // Cambiar cada 5 segundos
            }
        },
        resetInterval: () => { // Reiniciar intervalo al navegar manually
            PromoCarousel.startInterval();
        }
    };

    // --- Countdown Timer ---
    const Countdown = {
         // Set a future date (e.g., 3 days from now) for demonstration
         targetDate: new Date(new Date().getTime() + 3 * 24 * 60 * 60 * 1000),
        init: () => {
             if (!DOM.countdownContainer) return;
             // Ensure the elements exist before trying to update
             if(DOM.countdownContainer.querySelector('[data-unit="days"]')) {
                Countdown.update(); // Primera actualización inmediata
                countdownInterval = setInterval(Countdown.update, 1000); // Actualizar cada segundo
             } else {
                console.warn("Countdown elements not found.");
             }
         },
         update: () => {
             const now = new Date().getTime();
             const distance = Countdown.targetDate.getTime() - now;

             // Select elements inside the update function
             const daysEl = DOM.countdownContainer?.querySelector('[data-unit="days"]');
             const hoursEl = DOM.countdownContainer?.querySelector('[data-unit="hours"]');
             const minutesEl = DOM.countdownContainer?.querySelector('[data-unit="minutes"]');
             const secondsEl = DOM.countdownContainer?.querySelector('[data-unit="seconds"]');

             if (distance < 0) {
                 clearInterval(countdownInterval);
                 if (DOM.countdownContainer) DOM.countdownContainer.innerHTML = "<p>¡La oferta ha terminado!</p>";
                 return;
             }

             const days = Math.floor(distance / (1000 * 60 * 60 * 24));
             const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
             const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
             const seconds = Math.floor((distance % (1000 * 60)) / 1000);

             const format = (num) => String(num).padStart(2, '0');

             // Update only if the element exists and the value changed
             if (daysEl && daysEl.textContent !== format(days)) daysEl.textContent = format(days);
             if (hoursEl && hoursEl.textContent !== format(hours)) hoursEl.textContent = format(hours);
             if (minutesEl && minutesEl.textContent !== format(minutes)) minutesEl.textContent = format(minutes);
             if (secondsEl && secondsEl.textContent !== format(seconds)) secondsEl.textContent = format(seconds);
         }
     };
     // Elimina la clase 'visible' para que el modal se oculte
Utils.removeClass(DOM.modalOverlay, 'visible');


    // --- Animaciones Scroll y Header ---
    const Animations = {
        observer: null,
        init: () => {
            Animations.setupIntersectionObserver();
            Animations.observeElements(); // Observe initial elements
            window.addEventListener('scroll', Utils.throttle(Animations.handleScroll, 100)); // Throttle for optimizing scroll events
            Animations.handleScroll(); // Initial check for header state
        },
        setupIntersectionObserver: () => {
             const options = {
                 root: null, // viewport
                 rootMargin: '0px',
                 threshold: 0.1 // 10% visible to trigger
             };
             Animations.observer = new IntersectionObserver((entries, observer) => {
                 entries.forEach(entry => {
                     if (entry.isIntersecting) {
                         Utils.addClass(entry.target, 'is-visible');
                         observer.unobserve(entry.target); // Stop observing once animated
                     }
                 });
             }, options);
         },
         observeElements: () => {
            // Re-query elements each time in case the DOM changed (e.g., filtering/sorting)
            const elements = document.querySelectorAll('.animate-on-scroll:not(.is-visible), .section-title:not(.is-visible)');
            elements.forEach(el => {
                 if (Animations.observer) { // Check if observer exists
                    Animations.observer.observe(el);
                 }
            });
         },
         handleScroll: () => {
             // Sticky header effect
             if (DOM.mainHeader) {
                 Utils.toggleClass(DOM.mainHeader, 'scrolled', window.scrollY > 50);
             }
         }
     };

     // --- Inicialización General ---
     document.addEventListener('DOMContentLoaded', () => {
         Cart.init();
         Modal.init();
         Products.init(); // This now initializes search listeners too
         PromoCarousel.init();
         Countdown.init();
         Animations.init();
     });

     // --- Guardar Carrito al Salir ---
     window.addEventListener('beforeunload', () => Cart.save());

})();

