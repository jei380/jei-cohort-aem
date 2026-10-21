import {
  InLineAlert,
  Icon,
  Button,
  provider as UI,
} from '@dropins/tools/components.js';
import { h } from '@dropins/tools/preact.js';
import { events } from '@dropins/tools/event-bus.js';
import { tryRenderAemAssetsImage } from '@dropins/tools/lib/aem/assets.js';
import * as pdpApi from '@dropins/storefront-pdp/api.js';
import { render as pdpRendered } from '@dropins/storefront-pdp/render.js';
import { render as wishlistRender } from '@dropins/storefront-wishlist/render.js';

import { WishlistToggle } from '@dropins/storefront-wishlist/containers/WishlistToggle.js';
import { WishlistAlert } from '@dropins/storefront-wishlist/containers/WishlistAlert.js';

// Containers
import ProductHeader from '@dropins/storefront-pdp/containers/ProductHeader.js';
import ProductPrice from '@dropins/storefront-pdp/containers/ProductPrice.js';
import ProductShortDescription from '@dropins/storefront-pdp/containers/ProductShortDescription.js';
import ProductOptions from '@dropins/storefront-pdp/containers/ProductOptions.js';
import ProductQuantity from '@dropins/storefront-pdp/containers/ProductQuantity.js';
import ProductDescription from '@dropins/storefront-pdp/containers/ProductDescription.js';
import ProductAttributes from '@dropins/storefront-pdp/containers/ProductAttributes.js';
import ProductGallery from '@dropins/storefront-pdp/containers/ProductGallery.js';
import ProductGiftCardOptions from '@dropins/storefront-pdp/containers/ProductGiftCardOptions.js';

// Libs
import {
  rootLink,
  setJsonLd,
  fetchPlaceholders,
  getProductLink,
} from '../../scripts/commerce.js';

// Initializers
import { IMAGES_SIZES } from '../../scripts/initializers/pdp.js';
import '../../scripts/initializers/cart.js';
import '../../scripts/initializers/wishlist.js';

const BADGING_ACTION_ENDPOINT = window.AEM_BADGING_ACTION_ENDPOINT
  || 'https://3967933-237champagnecicada-stage.adobeioruntime.net/api/v1/web/course-labs/product-badging?sku=';
const meshBadgeCache = new Map();
const MESH_BADGE_TIMEOUT_MS = 3500;
const ENABLE_BADGE_FETCH = true;

/**
 * Checks if the page has prerendered product JSON-LD data
 * @returns {boolean} True if product JSON-LD exists and contains @type=Product
 */
function isProductPrerendered() {
  const jsonLdScript = document.querySelector('script[type="application/ld+json"]');

  if (!jsonLdScript?.textContent) {
    return false;
  }

  try {
    const jsonLd = JSON.parse(jsonLdScript.textContent);
    return jsonLd?.['@type'] === 'Product';
  } catch (error) {
    console.debug('Failed to parse JSON-LD:', error);
    return false;
  }
}

// Function to update the Add to Cart button text
function updateAddToCartButtonText(addToCartInstance, inCart, labels) {
  const buttonText = inCart
    ? labels.Global?.UpdateProductInCart
    : labels.Global?.AddProductToCart;
  if (addToCartInstance) {
    addToCartInstance.setProps((prev) => ({
      ...prev,
      children: buttonText,
    }));
  }
}

/**
 * Formats numeric attribute values for display (e.g., "10.000000" → "10").
 * Non-numeric values are returned as-is.
 */
function formatNumericAttributeValue(value) {
  const trimmed = value.trim();
  if (!/^[+-]?\d+(\.\d+)?$/.test(trimmed)) return value;
  return new Intl.NumberFormat(document.documentElement.lang).format(Number(trimmed));
}

function normalizeTierClass(tierThreshold) {
  const tier = Number(tierThreshold);
  if (tier === 1) return 'product-details-badge--tier-1';
  if (tier === 2) return 'product-details-badge--tier-2';
  if (tier === 3) return 'product-details-badge--tier-3';
  return '';
}

function renderBadgeElements(badgeText, tierThreshold, $badge, $badgeMobile) {
  const resolvedBadge = badgeText?.trim?.();
  const tierClass = normalizeTierClass(tierThreshold);

  if (!resolvedBadge) {
    if ($badge) {
      $badge.textContent = '';
      $badge.className = 'product-details__badge product-details-badge--hidden';
    }

    if ($badgeMobile) {
      $badgeMobile.textContent = '';
      $badgeMobile.className = 'product-details__badge product-details-badge--hidden';
    }
    return;
  }

  if ($badge) {
    $badge.textContent = resolvedBadge;
    $badge.className = `product-details__badge product-details-badge--badge-default ${tierClass}`.trim();
  }

  if ($badgeMobile) {
    $badgeMobile.textContent = resolvedBadge;
    $badgeMobile.className = `product-details__badge product-details-badge--badge-mobile ${tierClass}`.trim();
  }
}

async function fetchMeshBadgeBySku(sku) {
  if (!ENABLE_BADGE_FETCH) return '';
  if (!sku) return '';
  if (meshBadgeCache.has(sku)) return meshBadgeCache.get(sku);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), MESH_BADGE_TIMEOUT_MS);

    const response = await fetch(`${BADGING_ACTION_ENDPOINT}${encodeURIComponent(sku)}`, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const emptyResult = {
        badgeText: '',
        tierThreshold: null,
      };
      meshBadgeCache.set(sku, emptyResult);
      return emptyResult;
    }

    const result = await response.json();

    const resolvedResult = {
      badgeText: result?.deepDiscountBadge?.trim?.()
        || result?.body?.deepDiscountBadge?.trim?.()
        || '',
      tierThreshold: result?.tierThreshold
        ?? result?.body?.tierThreshold
        ?? null,
    };
    meshBadgeCache.set(sku, resolvedResult);
    return resolvedResult;
  } catch (error) {
    if (error?.name === 'AbortError') {
      console.debug('[PDP DEBUG] action badging request timed out');
    }
    console.debug('[PDP DEBUG] action badging request failed:', error);
    const emptyResult = {
      badgeText: '',
      tierThreshold: null,
    };
    meshBadgeCache.set(sku, emptyResult);
    return emptyResult;
  }
}

async function updateBadgeFromSources(productData, $badge, $badgeMobile) {
  renderBadgeElements(
    productData?.deepDiscountBadge,
    productData?.tierThreshold,
    $badge,
    $badgeMobile,
  );

  const meshBadge = await fetchMeshBadgeBySku(productData?.sku);
  if (meshBadge?.badgeText) {
    renderBadgeElements(meshBadge.badgeText, meshBadge.tierThreshold, $badge, $badgeMobile);
  }
}

export default async function decorate(block) {
  const eventProduct = events.lastPayload('pdp/data') ?? null;
  // bug: the pdp sends an object with event data even if product is not found.
  const product = eventProduct?.sku ? eventProduct : null;

  const labels = await fetchPlaceholders();

  // Read itemUid from URL
  const urlParams = new URLSearchParams(window.location.search);
  const itemUidFromUrl = urlParams.get('itemUid');

  // State to track if we are in update mode
  let isUpdateMode = false;

  // State to track if the current product/variant is out of stock
  let isOutOfStock = false;

  // Layout
  const fragment = document.createRange().createContextualFragment(`
    <div class="product-details__alert"></div>
    <div class="product-details__wrapper">
      <div class="product-details__left-column">
        <div class="product-details__badge"></div>
        <div class="product-details__gallery"></div>
      </div>
      <div class="product-details__right-column">
        <div class="product-details__header"></div>
        <div class="product-details__tagline pdp-tagline" aria-label="Promotional offer"></div>
        <div class="product-details__stock" role="status" aria-live="polite"></div>
        <div class="product-details__price"></div>
        <div class="product-details__badge"></div>
        <div class="product-details__gallery"></div>
        <div class="product-details__short-description"></div>
        <div class="product-details__gift-card-options"></div>
        <div class="product-details__configuration">
          <div class="product-details__options"></div>
          <div class="product-details__quantity"></div>
          <div class="product-details__buttons">
            <div class="product-details__buttons__add-to-cart"></div>
            <div class="product-details__buttons__add-to-wishlist"></div>
          </div>
          <div class="product-details__add-to-cart-status" role="status" aria-live="polite"></div>
        </div>
        <div class="product-details__description"></div>
        <div class="product-details__attributes"></div>
        <div class="product-details__custom-attribute"></div>
      </div>
    </div>
  `);

  const $alert = fragment.querySelector('.product-details__alert');
  const $badge = fragment.querySelector('.product-details__badge');
  const $gallery = fragment.querySelector('.product-details__gallery');
  const $header = fragment.querySelector('.product-details__header');
  const $tagline = fragment.querySelector('.product-details__tagline');
  const $stock = fragment.querySelector('.product-details__stock');
  const $price = fragment.querySelector('.product-details__price');
  const $badgeMobile = fragment.querySelector('.product-details__right-column .product-details__badge');
  const $galleryMobile = fragment.querySelector('.product-details__right-column .product-details__gallery');
  const $shortDescription = fragment.querySelector('.product-details__short-description');
  const $options = fragment.querySelector('.product-details__options');
  const $quantity = fragment.querySelector('.product-details__quantity');
  const $giftCardOptions = fragment.querySelector('.product-details__gift-card-options');
  const $addToCart = fragment.querySelector('.product-details__buttons__add-to-cart');
  const $wishlistToggleBtn = fragment.querySelector('.product-details__buttons__add-to-wishlist');
  // Kept mounted at all times so the "Adding to Cart" status is reliably
  // announced instead of relying on the button's text/disabled state
  // changing, which isn't announced by screen readers on its own.
  const $addToCartStatus = fragment.querySelector('.product-details__add-to-cart-status');
  const $description = fragment.querySelector('.product-details__description');
  const $attributes = fragment.querySelector('.product-details__attributes');
  const $customAttribute = fragment.querySelector('.product-details__custom-attribute');

  block.replaceChildren(fragment);

  if ($tagline) {
    $tagline.textContent = 'Free shipping on orders over $50';
  }

  debugPdpBadge(product);

  updateBadgeFromSources(product, $badge, $badgeMobile)
    .catch((error) => {
      console.debug('[PDP DEBUG] failed to update badge from sources:', error);
    });

  // eslint-disable-next-line no-shadow
  events.on('pdp/data', (product) => {
    if (!product) return;
    if (product.inStock) {
      $stock.textContent = '● In Stock';
      $stock.className = 'product-details__stock stock-badge stock-badge--in-stock';
    } else {
      $stock.textContent = '● Out of Stock';
      $stock.className = 'product-details__stock stock-badge stock-badge--out-of-stock';
    }
    const value = product.metaTitle;
    if (value) {
      $customAttribute.innerHTML = `
      <div class="custom-attribute">
      <dt>Product Title!!!!!!</dt>
      <dd>${value}</dd>
      </div>
      `;
    }
    // const badgeValue = product.deepDiscountBadge;
    // if (badgeValue) {
    //   $badge.textContent = badgeValue;
    //   $badge.className = 'product-details__badge product-details-badge--badge-default';
    //   $badgeMobile.textContent = badgeValue;
    //   $badgeMobile.className = 'product-details__badge product-details-badge--badge-mobile';
    // }
  }, { eager: true });

  const gallerySlots = {
    CarouselThumbnail: (ctx) => {
      if (ctx.mediaType === 'image') {
        tryRenderAemAssetsImage(ctx, {
          ...imageSlotConfig(ctx),
          wrapper: document.createElement('span'),
        });
      }
    },

    CarouselMainImage: (ctx) => {
      if (ctx.mediaType === 'image') {
        tryRenderAemAssetsImage(ctx, {
          ...imageSlotConfig(ctx),
        });
      }
    },
  };

  // Alert
  let inlineAlert = null;
  const routeToWishlist = rootLink('/wishlist');

  const [
    _galleryMobile,
    _gallery,
    _header,
    _price,
    _shortDescription,
    _options,
    _quantity,
    _giftCardOptions,
    _description,
    _attributes,
    wishlistToggleBtn,
  ] = await Promise.all([
    // Gallery (Mobile)
    pdpRendered.render(ProductGallery, {
      controls: 'dots',
      arrows: true,
      peak: false,
      gap: 'small',
      loop: false,
      videos: true, // Display videos if available
      imageParams: {
        ...IMAGES_SIZES,
      },

      slots: gallerySlots,
    })($galleryMobile),

    // Gallery (Desktop)
    pdpRendered.render(ProductGallery, {
      controls: 'thumbnailsColumn',
      arrows: true,
      peak: true,
      gap: 'small',
      loop: false,
      videos: true, // Display videos if available
      imageParams: {
        ...IMAGES_SIZES,
      },

      slots: gallerySlots,
    })($gallery),

    // Header
    pdpRendered.render(ProductHeader, {})($header),

    // Price
    pdpRendered.render(ProductPrice, {})($price),

    // Short Description
    pdpRendered.render(ProductShortDescription, {})($shortDescription),

    // Configuration - Swatches
    pdpRendered.render(ProductOptions, {
      hideSelectedValue: false,
      slots: {
        SwatchImage: (ctx) => {
          tryRenderAemAssetsImage(ctx, {
            ...imageSlotConfig(ctx),
            wrapper: document.createElement('span'),
          });
        },
      },
    })($options),

    // Configuration  Quantity
    pdpRendered.render(ProductQuantity, {})($quantity),

    // Configuration  Gift Card Options
    pdpRendered.render(ProductGiftCardOptions, {})($giftCardOptions),

    // Description
    pdpRendered.render(ProductDescription, {})($description),

    // Attributes
    pdpRendered.render(ProductAttributes, {
      formatValue: formatNumericAttributeValue,
    })($attributes),

    // Wishlist button - WishlistToggle Container
    wishlistRender.render(WishlistToggle, {
      product,
    })($wishlistToggleBtn),
  ]);

  // Configuration – Button - Add to Cart
  const addToCart = await UI.render(Button, {
    children: labels.Global?.AddProductToCart,
    icon: h(Icon, { source: 'Cart' }),
    onClick: async () => {
      const buttonActionText = isUpdateMode
        ? labels.Global?.UpdatingInCart
        : labels.Global?.AddingToCart;
      try {
        addToCart.setProps((prev) => ({
          ...prev,
          children: buttonActionText,
          disabled: true,
        }));
        $addToCartStatus.textContent = buttonActionText ?? 'Adding to Cart';

        // get the current selection values
        const values = pdpApi.getProductConfigurationValues();
        const valid = pdpApi.isProductConfigurationValid();

        // add or update the product in the cart
        if (valid) {
          if (isUpdateMode) {
            // --- Update existing item ---
            const { updateProductsFromCart } = await import(
              '@dropins/storefront-cart/api.js'
            );

            await updateProductsFromCart([{ ...values, uid: itemUidFromUrl }]);

            // --- START REDIRECT ON UPDATE ---
            const updatedSku = values?.sku;
            if (updatedSku) {
              const cartRedirectUrl = new URL(
                rootLink('/cart'),
                window.location.origin,
              );
              cartRedirectUrl.searchParams.set('itemUid', itemUidFromUrl);
              window.location.href = cartRedirectUrl.toString();
            } else {
              // Fallback if SKU is somehow missing (shouldn't happen in normal flow)
              console.warn(
                'Could not retrieve SKU for updated item. Redirecting to cart without parameter.',
              );
              window.location.href = rootLink('/cart');
            }
            return;
          }
          // --- Add new item ---
          const { addProductsToCart } = await import(
            '@dropins/storefront-cart/api.js'
          );
          await addProductsToCart([{ ...values }]);
        }

        // reset any previous alerts if successful
        inlineAlert?.remove();
      } catch (error) {
        // add alert message
        inlineAlert = await UI.render(InLineAlert, {
          heading: 'Error',
          description: error.message,
          icon: h(Icon, { source: 'Warning' }),
          'aria-live': 'assertive',
          role: 'alert',
          onDismiss: () => {
            inlineAlert.remove();
          },
        })($alert);

        // Scroll the alertWrapper into view
        $alert.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      } finally {
        // Reset button text using the helper function which respects the current mode
        updateAddToCartButtonText(addToCart, isUpdateMode, labels);
        // Re-enable button, unless the current variant is out of stock
        addToCart.setProps((prev) => ({
          ...prev,
          disabled: isOutOfStock,
        }));
        $addToCartStatus.textContent = '';
      }
    },
  })($addToCart);

  // Lifecycle Events
  events.on('pdp/data', (data) => {
    isOutOfStock = data?.inStock === false;
    addToCart.setProps((prev) => ({ ...prev, disabled: isOutOfStock }));
  }, { eager: true });

  events.on('pdp/valid', (valid) => {
    // update add to cart button disabled state based on product selection validity and stock status
    addToCart.setProps((prev) => ({ ...prev, disabled: isOutOfStock || !valid }));
  }, { eager: true });

  // Handle option changes
  events.on('pdp/values', () => {
    if (wishlistToggleBtn) {
      const configValues = pdpApi.getProductConfigurationValues();

      // Check URL parameter for empty optionsUIDs
      const urlOptionsUIDs = urlParams.get('optionsUIDs');

      // If URL has empty optionsUIDs parameter, treat as base product (no options)
      const optionUIDs = urlOptionsUIDs === '' ? undefined : (configValues?.optionsUIDs || undefined);

      wishlistToggleBtn.setProps((prev) => ({
        ...prev,
        product: {
          ...product,
          optionUIDs,
        },
      }));
    }
  }, { eager: true });

  events.on('wishlist/alert', ({ action, item }) => {
    wishlistRender.render(WishlistAlert, {
      action,
      item,
      routeToWishlist,
    })($alert);

    setTimeout(() => {
      $alert.innerHTML = '';
    }, 5000);

    setTimeout(() => {
      $alert.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }, 0);
  });

  // --- Add new event listener for cart/data ---
  events.on(
    'cart/data',
    (cartData) => {
      let itemIsInCart = false;
      if (itemUidFromUrl && cartData?.items) {
        itemIsInCart = cartData.items.some(
          (item) => item.uid === itemUidFromUrl,
        );
      }
      // Set the update mode state
      isUpdateMode = itemIsInCart;

      // Update button text based on whether the item is in the cart
      updateAddToCartButtonText(addToCart, itemIsInCart, labels);
    },
    { eager: true },
  );

  // Set JSON-LD and Meta Tags
  events.on('aem/lcp', () => {
    const isPrerendered = isProductPrerendered();
    if (product && !isPrerendered) {
      setJsonLdProduct(product);
      setMetaTags(product);
      document.title = product.name;
    }
  }, { eager: true });

  return Promise.resolve();
}

async function setJsonLdProduct(product) {
  const {
    name,
    inStock,
    description,
    sku,
    urlKey,
    price,
    priceRange,
    images,
    attributes,
  } = product;
  const amount = priceRange?.minimum?.final?.amount || price?.final?.amount;
  const brand = attributes?.find((attr) => attr.name === 'brand');

  // get variants
  const { data } = await pdpApi.fetchGraphQl(`
    query GET_PRODUCT_VARIANTS($sku: String!) {
      variants(sku: $sku) {
        variants {
          product {
            sku
            name
            inStock
            images(roles: ["image"]) {
              url
            }
            ...on SimpleProductView {
              price {
                final { amount { currency value } }
              }
            }
          }
        }
      }
    }
  `, {
    method: 'GET',
    variables: { sku },
  });

  const variants = data?.variants?.variants || [];

  const ldJson = {
    '@context': 'http://schema.org',
    '@type': 'Product',
    name,
    description,
    image: images[0]?.url,
    offers: [],
    productID: sku,
    brand: {
      '@type': 'Brand',
      name: brand?.value,
    },
    url: new URL(getProductLink(urlKey, sku), window.location),
    sku,
    '@id': new URL(getProductLink(urlKey, sku), window.location),
  };

  if (variants.length > 1) {
    ldJson.offers.push(...variants
      // A variant can come back without a resolved product (e.g. an
      // unavailable option combination); skip those so JSON-LD generation
      // doesn't throw on null property access.
      .filter((variant) => variant.product)
      .map((variant) => ({
        '@type': 'Offer',
        name: variant.product.name,
        image: variant.product.images?.[0]?.url,
        price: variant.product.price?.final?.amount?.value,
        priceCurrency: variant.product.price?.final?.amount?.currency,
        availability: variant.product.inStock ? 'http://schema.org/InStock' : 'http://schema.org/OutOfStock',
        sku: variant.product.sku,
      })));
  } else {
    ldJson.offers.push({
      '@type': 'Offer',
      price: amount?.value,
      priceCurrency: amount?.currency,
      availability: inStock ? 'http://schema.org/InStock' : 'http://schema.org/OutOfStock',
    });
  }

  setJsonLd(ldJson, 'product');
}

function createMetaTag(property, content, type) {
  if (!property || !type) {
    return;
  }
  let meta = document.head.querySelector(`meta[${type}="${property}"]`);
  if (meta) {
    if (!content) {
      meta.remove();
      return;
    }
    meta.setAttribute(type, property);
    meta.setAttribute('content', content);
    return;
  }
  if (!content) {
    return;
  }
  meta = document.createElement('meta');
  meta.setAttribute(type, property);
  meta.setAttribute('content', content);
  document.head.appendChild(meta);
}

function setMetaTags(product) {
  if (!product?.sku) {
    return;
  }

  const price = product.prices.final.minimumAmount ?? product.prices.final.amount;

  createMetaTag('title', product.metaTitle || product.name, 'name');
  createMetaTag('description', product.metaDescription, 'name');
  createMetaTag('keywords', product.metaKeyword, 'name');

  createMetaTag('og:type', 'product', 'property');
  createMetaTag('og:description', product.shortDescription, 'property');
  createMetaTag('og:title', product.metaTitle || product.name, 'property');
  createMetaTag('og:url', window.location.href, 'property');
  const mainImage = product?.images?.filter((image) => image.roles.includes('thumbnail'))[0];
  const metaImage = mainImage?.url || product?.images[0]?.url;
  createMetaTag('og:image', metaImage, 'property');
  createMetaTag('og:image:secure_url', metaImage, 'property');
  createMetaTag('product:price:amount', price.value, 'property');
  createMetaTag('product:price:currency', price.currency, 'property');
}

/**
 * Returns the configuration for an image slot.
 * @param ctx - The context of the slot.
 * @returns The configuration for the image slot.
 */
function imageSlotConfig(ctx) {
  const { data, defaultImageProps } = ctx;
  return {
    alias: data.sku,
    imageProps: defaultImageProps,

    params: {
      width: defaultImageProps.width,
      height: defaultImageProps.height,
    },
  };
}

/* eslint-disable no-console */
function debugPdpBadge(productData) {
  // Toggle via URL: ?debugPdp=1
  const debugEnabled = new URLSearchParams(window.location.search).get('debugPdp') === '1';
  if (!debugEnabled) return;

  console.group('[PDP DEBUG] pdp/data payload');
  console.log('full product payload:', productData);
  console.log('sku:', productData?.sku);
  console.log('deepDiscountBadge (raw):', productData?.deepDiscountBadge);
  console.log('deepDiscountBadge (type):', typeof productData?.deepDiscountBadge);
  console.log('deepDiscountBadge (trimmed):', productData?.deepDiscountBadge?.trim?.());
  console.groupEnd();
}
/* eslint-enable no-console */
