import { PaymentStatusPage } from "./payment";

function FailedPaymentPage(props) {
  return <PaymentStatusPage variant="failed" {...props} />;
}

export default FailedPaymentPage;
