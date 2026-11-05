import Link from "next/link";

export default function NotFound() {
  return (
    <div className="state">
      <h3>Page not found</h3>
      <p>
        <Link href="/">Return to the overview</Link>
      </p>
    </div>
  );
}
