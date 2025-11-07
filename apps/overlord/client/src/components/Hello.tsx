import React from "react";
import { useHello } from "../hooks/useHello";

export const Hello: React.FC = () => {
  const { data, isLoading, error } = useHello();

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (error) {
    return <div>Error: {error.message}</div>;
  }

  return (
    <div>
      <h2>Hello World Response</h2>
      <p>
        <strong>Message:</strong> {data?.message}
      </p>
      <p>
        <strong>Timestamp:</strong> {data?.timestamp}
      </p>
      <p>
        <strong>Success:</strong> {data?.success ? "Yes" : "No"}
      </p>
    </div>
  );
};
