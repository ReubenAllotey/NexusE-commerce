import { Link } from "react-router-dom";

const footerLinks = {
  support: ["Accra-Ghana", "info@nexushubgh", "0556428948"],
  account: [
    { label: "My Account", to: "/profile/dashboard" },
    { label: "Login", to: "/register/login" },
    { label: "Register", to: "/register/signup" },
    { label: "Cart", to: "/cart" },
    { label: "Wishlist", to: "/wishlist" },
    { label: "Shop", to: "/products" },
  ],
  quickLink: [
    { label: "About", to: "/about" },
    { label: "Contact", to: "/contact" },
  ],
};

const socialLinks = [
  {
    label: "Facebook",
    href: "https://www.facebook.com/share/1HoDuuHb43/?mibextid=wwXIfr",
    short: "f",
  },
  {
    label: "TikTok",
    href: "https://www.tiktok.com/@nexusimporthub?_r=1&_t=ZS-98u5xJbNI5V",
    short: "t",
  },
  {
    label: "Instagram",
    href: "https://www.instagram.com/nexus_importhub?igsh=eGwwb29rd3I5Y2wz&utm_source=qr",
    short: "i",
  },
];

function SiteFooter({ logoSrc, logoAlt = "Nexus logo" }) {
  return (
    <footer className="site-footer" id="footer">
      <div className="site-shell site-footer__inner">
        <div className="site-footer__brand">
          <div className="site-footer__brand-row">
            {logoSrc ? (
              <img src={logoSrc} alt={logoAlt} className="site-footer__logo" />
            ) : null}
            <div>
              <h3>Nexus Imports </h3>
              <p>Subscribe</p>
            </div>
          </div>
          <span>Connect with us on social media</span>

          <div className="site-footer__social-links" aria-label="Social media links">
            {socialLinks.map((item) => (
              <a
                key={item.label}
                href={item.href}
                target="_blank"
                rel="noreferrer"
                aria-label={item.label}
                className="site-footer__social-link"
              >
                {item.short}
              </a>
            ))}
          </div>
        </div>

        <div className="site-footer__column">
          <h3>Support</h3>
          {footerLinks.support.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>

        <div className="site-footer__column">
          <h3>Account</h3>
          {footerLinks.account.map((item) => (
            <Link to={item.to} key={item.label}>
              {item.label}
            </Link>
          ))}
        </div>

        <div className="site-footer__column">
          <h3>Quick Link</h3>
          {footerLinks.quickLink.map((item) => (
            <Link to={item.to} key={item.label}>
              {item.label}
            </Link>
          ))}
        </div>

        <div className="site-footer__column">
          <h3>Connect</h3>
          <div className="site-footer__socials" aria-label="Social links">
            {socialLinks.map((item) => (
              <a
                key={item.label}
                href={item.href}
                target="_blank"
                rel="noreferrer"
                aria-label={item.label}
              >
                {item.short}
              </a>
            ))}
          </div>
        </div>
      </div>

      <div className="site-shell site-footer__bottom">
        <p>Copyright @ Nexus 2026</p>
      </div>
    </footer>
  );
}

export default SiteFooter;
