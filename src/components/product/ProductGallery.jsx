import { useState } from 'react';
import { getOptimizedImageUrl } from '../../utils/cloudinaryImage';
import './ProductGallery.css';

/**
 * Bug fix: the main image previously popped in abruptly once loaded,
 * with a plain flat-color box visible until then — on a first-ever
 * request for a given Cloudinary transformation (e.g. this exact
 * width/format combination for this specific image), Cloudinary
 * generates it on the fly, which can take a moment. That's normal and
 * expected, but with no loading affordance it looked like a blank or
 * broken image rather than "still loading." This adds a soft pulsing
 * placeholder and a fade-in once the image is actually ready.
 *
 * `key={src}` on GalleryImage forces a full remount (fresh loading
 * state) whenever the resolved image URL changes — whether from
 * clicking a different thumbnail, or navigating to an entirely
 * different product — so the loading state is never stale.
 */
function GalleryImage({ src, alt }) {
  const [loaded, setLoaded] = useState(false);

  return (
    <>
      {!loaded && <div className="product-gallery__skeleton" aria-hidden="true" />}
      {/* This is the Largest Contentful Paint element of every product
          page, and it cannot be discovered in the HTML — its URL only
          exists once Firestore has returned the product. fetchpriority
          at least makes the browser treat it as important the moment
          React does mount it, instead of queueing it behind the other
          images on the page (NEW-23). */}
      <img
        src={src}
        alt={alt}
        className={`product-gallery__image ${loaded ? 'product-gallery__image--loaded' : ''}`}
        // Lowercase deliberately — see ProductCard.jsx.
        // eslint-disable-next-line react/no-unknown-property
        fetchpriority="high"
        decoding="sync"
        onLoad={() => setLoaded(true)}
      />
    </>
  );
}

export default function ProductGallery({ images, name, size }) {
  const [active, setActive] = useState(0);
  const mainSrc = getOptimizedImageUrl(images[active], { width: 700 });

  return (
    <div className="product-gallery">
      <div className="product-gallery__main">
        <GalleryImage key={mainSrc} src={mainSrc} alt={name} />
        {size && <span className="product-gallery__size-badge">{size}</span>}
      </div>
      {images.length > 1 && (
        <div className="product-gallery__thumbs">
          {images.map((src, i) => (
            <button
              key={src}
              type="button"
              className={`product-gallery__thumb ${i === active ? 'product-gallery__thumb--active' : ''}`}
              onClick={() => setActive(i)}
              aria-label={`Show image ${i + 1} of ${images.length}`}
              aria-current={i === active}
            >
              <img src={getOptimizedImageUrl(src, { width: 120 })} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
