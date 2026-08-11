function ProfileSectionShell({ eyebrow, title, description, children }) {
  return (
    <section className="profile-section">
      {eyebrow ? <p className="profile-section__eyebrow">{eyebrow}</p> : null}
      <h1 className="profile-section__title">{title}</h1>
      {description ? (
        <p className="profile-section__description">{description}</p>
      ) : null}
      {children}
    </section>
  );
}

export default ProfileSectionShell;
