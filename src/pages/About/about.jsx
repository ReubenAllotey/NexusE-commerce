import { Link } from "react-router-dom";
import logoImage from "../../assets/images/nexuslogo.png";
import manImage from "../../assets/images/man.jpg";
import womanImage from "../../assets/images/Woman.jpg";

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

const founders = [
  {
    name: "Mr. Dela",
    role: "Founder & CEO",
    bio: "Leads the company vision, client relationships, and overall business direction.",
    image: manImage,
  },
  {
    name: "Mrs. Dela",
    role: "Co-Founder & Operations Lead",
    bio: "Oversees sourcing, logistics, and the day-to-day delivery experience.",
    image: womanImage,
  },
];

const whyChoose = [
  {
    title: "Reliable Importation",
    text: "We source and ship products directly from China with a process you can trust.",
  },
  {
    title: "Doorstep Delivery",
    text: "Your goods are delivered safely to your home, office, or business location.",
  },
  {
    title: "Sea & Air Freight",
    text: "Choose economical sea shipping or faster air delivery based on your needs.",
  },
  {
    title: "Batch Shipping",
    text: "Shipments are grouped into scheduled batches for better efficiency and lower costs.",
  },
  {
    title: "Secure Handling",
    text: "Your cargo is carefully managed throughout the shipping process.",
  },
  {
    title: "Trusted Service",
    text: "You get dedicated support from order placement to final delivery.",
  },
];

function About() {
  return (
    <main className="about-page">
      <section className="about-hero">
        <div className="site-shell about-hero__grid">
          <div className="about-hero__copy">
            <img
              className="about-hero__logo"
              src={logoImage}
              alt="Nexus Company logo"
            />
            <p className="about-hero__eyebrow">About Nexus Company</p>
            <p className="about-hero__lead">
              Nexus Company helps businesses source products from China with a
              straightforward process, reliable support, and honest updates.
            </p>

            <div className="about-hero__actions">
              <Link to="/products" className="about-hero__button">
                Explore Products <ArrowIcon />
              </Link>
              <Link to="/contact" className="about-hero__link">
                Contact Us
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="site-shell about-section">
        <div className="section-header about-section__header">
          <div>
            <p className="section-label">
              <span />
              Why Choose Nexus Company
            </p>
            <h2>Simple importing, dependable shipping, and clear support.</h2>
          </div>
        </div>

        <div className="about-overview">
          <div className="about-overview__intro">
            <p>
              At Nexus Company, we make importing from China simple, reliable,
              and stress-free. Whether you are sourcing products in bulk or
              buying personal items, we handle the full shipping process from
              trusted suppliers in China to your doorstep.
            </p>
            <p>
              Our experienced team manages cargo consolidation, shipping
              coordination, customs support, and final delivery. We also offer
              sea freight and air freight, with shipments organized in batches
              to keep logistics efficient and costs competitive.
            </p>
          </div>

          <div className="about-overview__grid">
            {whyChoose.map((item, index) => (
              <article className="about-overview__card" key={item.title}>
                <span className="about-overview__index">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="site-shell about-section">
        <div className="section-header about-section__header">
          <div>
            <p className="section-label">
              <span />
              Leadership
            </p>
            <h2>Meet the people leading Nexus Company.</h2>
          </div>
        </div>

        <div className="about-founders">
          {founders.map((person) => (
            <article className="about-founders__card" key={person.name}>
              <div className="about-founders__avatar">
                <img src={person.image} alt={person.name} />
              </div>
              <div className="about-founders__content">
                <p className="about-founders__role">{person.role}</p>
                <h3>{person.name}</h3>
                <p>{person.bio}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <footer className="site-footer" id="footer">
        <div className="site-shell site-footer__inner">
          <div className="site-footer__brand">
            <div className="site-footer__brand-row">
              <img
                src={logoImage}
                alt="Nexus logo "
                className="site-footer__logo"
              />
              <div>
                <h3>Nexus Imports </h3>
                <p>Subscribe</p>
              </div>
            </div>
            <span>Get 10% off your first order</span>

            <form
              className="site-footer__form"
              onSubmit={(event) => event.preventDefault()}
            >
              <input
                type="email"
                placeholder="Enter your email"
                aria-label="Email address"
              />
              <button type="submit" aria-label="Subscribe">
                &rarr;
              </button>
            </form>
          </div>

          <div className="site-footer__column">
            <h3>Support</h3>
            <span>Accra-Ghana</span>
            <span>nexusimport@gmail.com</span>
            <span>+233 53-404-8292</span>
          </div>

          <div className="site-footer__column">
            <h3>Account</h3>
            <Link to="/profile/dashboard">My Account</Link>
            <Link to="/register/login">Login</Link>
            <Link to="/register/signup">Register</Link>
            <Link to="/cart">Cart</Link>
            <Link to="/wishlist">Wishlist</Link>
            <Link to="/products">Shop</Link>
          </div>

          <div className="site-footer__column">
            <h3>Quick Link</h3>
            <Link to="/about">About</Link>
            <Link to="/contact">Contact</Link>
          </div>

          <div className="site-footer__column">
            <h3>Connect</h3>
            <div className="site-footer__socials" aria-label="Social links">
              <span>f</span>
              <span>t</span>
              <span>i</span>
              <span>in</span>
            </div>
          </div>
        </div>

        <div className="site-shell site-footer__bottom">
          <p>Copyright @ Nexus 2026</p>
        </div>
      </footer>
    </main>
  );
}

export default About;
