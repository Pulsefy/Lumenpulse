import { View, Text, Button } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../src/context/AuthContext";

export default function Login() {
  const { login } = useAuth();
  const router = useRouter();

  const handleLogin = async () => {
    // Mock login (no real API yet)
    await login(
      { id: "1", email: "test@email.com" },
      "mock-jwt-token"
    );

    router.replace("/(tabs)/portfolio");
  };

  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        padding: 20,
      }}
    >
      <Text style={{ fontSize: 22, marginBottom: 20 }}>
        Login Screen
      </Text>

      <Button title="Mock Login" onPress={handleLogin} />
    </View>
  );
}