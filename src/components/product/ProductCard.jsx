import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { ROUTES } from '../../config/routes';
import { formatINR } from '../../utils/currency';
import { getProductPricing } from '../../utils/pricing';
import { getOptimizedImageUrl } from '../../utils/cloudinaryImage';
import { getPrimaryImage } from '../../utils/productImage';
import { safeExternalUrl } from '../../utils/safeUrl';
import { useOffers } from '../../context/OffersContext';
import { useWishlist } from '../../context/WishlistContext';
import './ProductCard.css';

/**
 * `priority` marks a card that is above the fold on first paint.
 *
 * Every card image used to be `loading="lazy"`, including the ones
 * already in the viewport. A lazy image is not requested until the
 * browser has done layout and decided it is near the viewport, which on
 * the catalogue page made the very first product photo — the Largest
 * Contentful Paint element — wait an extra ~1.2s that it did not need
 * to ("LCP resources should not use loading=lazy", NEW-23). Lazy
 * loading is still exactly right for the rest of the grid, so it stays
 * the default and only the first row opts out.
 */
export default function ProductCard({ product, priority = false }) {
  const navigate = useNavigate();
  const { offers } = useOffers();
  const { isWishlisted, toggleWishlist } = useWishlist();
  const [justToggled, setJustToggled] = useState(false);
  const pricing = getProductPricing(product, offers);
  const wishlisted = isWishlisted(product.id);
  // Security audit 2026-09-18 (SEC-04): this href comes from a Firestore
  // document, and React does not sanitize href — a stored `javascript:`
  // value would render as a working script link. safeExternalUrl returns
  // null for anything that isn't http(s), which hides the icon entirely.
  const instagramUrl = safeExternalUrl(product.instagramUrl);

  function handleWishlistClick(e) {
    e.preventDefault();
    e.stopPropagation();
    toggleWishlist(product.id);
    setJustToggled(true);
    setTimeout(() => setJustToggled(false), 320);
  }

  return (
    <article className="product-card">
      {/* Fix (NEW-12): the wishlist button used to sit INSIDE this link.
          A <button> nested in an <a> is invalid HTML — it only worked
          because of preventDefault, and assistive technology may not
          expose the button at all. The button is now a sibling,
          positioned over the image by the existing CSS. */}
      <div className="product-card__media">
        <Link to={ROUTES.productDetailPath(product.id)} className="product-card__media-link">
          <img
            src={getOptimizedImageUrl(getPrimaryImage(product), { width: 400 })}
            alt={product.name}
            loading={priority ? 'eager' : 'lazy'}
            // Lowercase deliberately, and the two tools disagree about
            // it. React 18 does not recognise the camelCase
            // `fetchPriority` prop: it lowercases the attribute anyway
            // but logs a warning on every single render, which buries
            // real warnings. eslint-plugin-react, meanwhile, has been
            // updated for React 19 (where camelCase is correct) and
            // flags the lowercase form. The runtime is the one the
            // person using the site experiences, so lowercase wins and
            // the lint rule is silenced here rather than project-wide.
            // Revisit both when this upgrades to React 19.
            // eslint-disable-next-line react/no-unknown-property
            fetchpriority={priority ? 'high' : undefined}
            decoding={priority ? 'sync' : 'async'}
          />
        </Link>
        {pricing.hasOffer && <span className="product-card__badge">{pricing.discountPercent}% OFF</span>}
        {product.size && <span className="product-card__size-badge">{product.size}</span>}
        <button
          type="button"
          className={`product-card__wishlist ${wishlisted ? 'product-card__wishlist--active' : ''} ${
            justToggled ? 'product-card__wishlist--pop' : ''
          }`}
          onClick={handleWishlistClick}
          aria-pressed={wishlisted}
          aria-label={wishlisted ? `Remove ${product.name} from wishlist` : `Add ${product.name} to wishlist`}
        >
          <HeartIcon filled={wishlisted} />
        </button>
      </div>

      <div className="product-card__body">
        <div className="product-card__category-row">
          <p className="product-card__category">{product.category}</p>
          {instagramUrl && (
            <a
              href={instagramUrl}
              target="_blank"
              rel="noreferrer"
              className="product-card__instagram"
              onClick={(e) => e.stopPropagation()}
              aria-label={`View ${product.name} on Instagram`}
            >
              <InstagramIcon />
            </a>
          )}
        </div>
        <Link to={ROUTES.productDetailPath(product.id)} className="product-card__name">
          {product.name}
        </Link>

        <div className="product-card__price-row">
          <span className="product-card__price">{formatINR(pricing.finalPrice)}</span>
          {pricing.hasOffer && <span className="product-card__price-original">{formatINR(pricing.price)}</span>}
        </div>

        <button
          type="button"
          className="product-card__view-btn"
          onClick={() => navigate(ROUTES.productDetailPath(product.id))}
        >
          View Details
        </button>
      </div>
    </article>
  );
}

function InstagramIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="4.3" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="17.4" cy="6.6" r="1.1" fill="currentColor" />
    </svg>
  );
}

function HeartIcon({ filled }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} aria-hidden="true">
      <path
        d="M12 20s-7.2-4.35-9.6-9.06C.86 7.86 2.4 4.5 5.7 4.02c2-.3 3.86.63 4.8 2.34a4.66 4.66 0 0 1 1.5-1.8c1.6-1.2 3.9-1.02 5.4.6 1.9 2.04 1.66 5.1-.3 7.8C15.3 15.7 12 20 12 20z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
